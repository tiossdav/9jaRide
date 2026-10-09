import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, UseInterceptors } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { Pool } from 'pg';
import { CurrentUser, Principal, Public, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { walletCode } from '../ledger/postings';
import { DebtService } from './debt.service';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { ReconciliationService } from './reconciliation.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

class TopUpDto {
  @IsInt() @Min(1) @Max(1_000_000_000) amountKobo!: number; // exact limits are enforced (and explained) by the service
}

class PayoutRequestDto {
  @IsInt() @Min(1) @Max(1_000_000_000) amountKobo!: number;
  @IsString() @Length(3, 10) bankCode!: string;
  @IsString() @Matches(/^[0-9]{10}$/, { message: 'accountNumber must be 10 digits' }) accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(100) accountName!: string;
}

class RejectDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

class StatusQuery {
  @IsOptional() @IsIn(['PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED']) status?: string;
}

/** Riders and drivers: their own wallet, top-ups and (drivers) payouts. */
@Controller()
export class WalletController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly ledger: LedgerService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Roles('rider', 'driver') @Get('wallet')
  async wallet(@CurrentUser() me: Principal) {
    const code = walletCode(me.id);
    return this.ledger.withTransaction(async (c) => ({
      balanceKobo: await this.ledger.balanceKobo(c, code),
      availableKobo: await this.ledger.availableKobo(c, code),
    }));
  }

  /** Money in and out of the wallet, newest first. */
  @Roles('rider', 'driver') @Get('wallet/transactions')
  async transactions(@CurrentUser() me: Principal) {
    const { rows } = await this.pool.query(
      `SELECT t.kind, t.memo, t.created_at, e.amount_kobo
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.id = e.account_id
         JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE a.code = $1 ORDER BY e.id DESC LIMIT 100`,
      [walletCode(me.id)],
    );
    return rows.map((r) => ({ kind: r.kind as string, memo: r.memo as string | null, at: r.created_at as Date, amountKobo: Number(r.amount_kobo) }));
  }

  @Roles('rider', 'driver') @Post('wallet/topups') @HttpCode(200)
  topUp(@CurrentUser() me: Principal, @Body() dto: TopUpDto) {
    return this.payments.initiateTopUp(me.id, dto.amountKobo);
  }

  /**
   * The app calls this when the person returns from the payment page. Paystack is asked directly, and the wallet is
   * credited here if the payment really went through, so the balance is right even before the webhook arrives.
   */
  @Roles('rider', 'driver') @Get('wallet/topups/:reference')
  async topUpStatus(@CurrentUser() me: Principal, @Param('reference') reference: string) {
    const status = await this.payments.topUpStatus(me.id, reference);
    if (!status) throw new NotFoundException('no such top-up');
    return status;
  }

  @Roles('driver') @Post('payouts') @HttpCode(200)
  request(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: PayoutRequestDto) {
    return this.payouts.request({
      driverId: me.id,
      amountKobo: dto.amountKobo,
      bank: { bankCode: dto.bankCode, accountNumber: dto.accountNumber, accountName: dto.accountName },
      idempotencyKey: key,
      requestedBy: me.id,
    });
  }

  @Roles('driver') @Get('payouts')
  mine(@CurrentUser() me: Principal) {
    return this.payouts.listForDriver(me.id);
  }
}

/** A driver's own debt: what they owe, how much has been recovered by their later earnings and top-ups, and each step. */
@Controller()
export class DriverDebtController {
  constructor(private readonly debt: DebtService) {}

  @Roles('driver') @Get('driver/debt')
  mine(@CurrentUser() me: Principal) {
    return this.debt.forDriver(me.id);
  }
}

/** Paystack calls this. No login: the signature over the raw body is the authentication. */
@Controller()
export class WebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public() @Post('webhooks/paystack') @HttpCode(200)
  async paystack(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') signature?: string) {
    if (!req.rawBody) throw new BadRequestException('empty body');
    // A forged call gets 401 (see the exception filter); a processing failure gets 5xx so Paystack retries.
    return { outcome: await this.payments.handleWebhook(req.rawBody, signature) };
  }
}

const RETURN_TEXT: Record<string, [string, string]> = {
  success: ['Payment received', 'Your wallet has been topped up.'],
  pending: ['Payment is being confirmed', 'This can take a minute. Your balance will update in the app as soon as it is confirmed.'],
  cancelled: ['Payment not completed', 'You left the payment page before paying. Nothing was charged.'],
  failed: ['Payment failed', 'The payment did not go through. You were not charged. Please try again.'],
  mismatch: ['Payment needs checking', 'We could not match the amount paid. Our team will look into it, please contact support.'],
  unknown: ['Payment not found', 'We could not find this payment. Open the app and check your wallet.'],
};

/** The page Paystack sends the person to after paying or cancelling. It asks Paystack what happened; nothing here is trusted from the URL. */
@Controller()
export class PaymentReturnController {
  constructor(private readonly payments: PaymentsService) {}

  @Public() @Get('payments/return') @Header('Content-Type', 'text/html; charset=utf-8') @Header('Cache-Control', 'no-store')
  async back(@Query('reference') reference?: string, @Query('trxref') trxref?: string) {
    const ref = String(reference ?? trxref ?? '').slice(0, 100);
    const state = /^topup_[0-9a-f-]{36}$/.test(ref) ? (await this.payments.stateAfterReturn(ref)) ?? 'unknown' : 'unknown';
    const [title, text] = RETURN_TEXT[state];
    const ok = state === 'success';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>`
      + `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#06130c;color:#eaf5ee;font-family:system-ui,sans-serif;text-align:center;padding:24px">`
      + `<main style="max-width:360px"><div style="width:64px;height:64px;border-radius:50%;margin:0 auto 20px;background:${ok ? '#01ff07' : '#2a3a30'};color:#06130c;font-size:32px;line-height:64px">${ok ? '&#10003;' : '!'}</div>`
      + `<h1 style="font-size:24px;margin:0 0 10px">${title}</h1><p style="color:#a9bdb0;line-height:1.5;margin:0 0 22px">${text}</p>`
      + `<p style="color:#7f9887;font-size:14px;margin:0">You can close this page and go back to the 9jaRide app.</p></main></body></html>`;
  }
}

/** Finance staff: approve payouts and watch reconciliation. Every change is written to the staff audit log. */
@Controller('admin')
@Roles('finance', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminPaymentsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly reconciliation: ReconciliationService,
    private readonly debt: DebtService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get('payouts')
  list(@Query() q: StatusQuery) {
    return this.payouts.listByStatus(q.status);
  }

  @Post('payouts/:id/approve') @HttpCode(200)
  async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return { approved: await this.payouts.approve(id, me.id) };
  }

  @Post('payouts/:id/reject') @HttpCode(200)
  async reject(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return { rejected: await this.payouts.reject(id, me.id, dto.reason) };
  }

  /** Drivers who owe the platform something right now. */
  @Get('debts')
  debts() {
    return this.debt.owing();
  }

  @Get('drivers/:id/debt')
  driverDebt(@Param('id', ParseUUIDPipe) id: string) {
    return this.debt.forDriverAsStaff(id);
  }

  @Get('reconciliation/findings')
  async findings() {
    const { rows } = await this.pool.query(
      `SELECT f.id, f.run_id, f.kind, f.reference, f.detail, f.created_at
         FROM reconciliation_findings f ORDER BY f.created_at DESC LIMIT 200`,
    );
    return rows;
  }

  @Post('reconciliation/run') @HttpCode(200)
  run() {
    return this.reconciliation.run();
  }
}
