import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, UseInterceptors } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { Pool } from 'pg';
import { CurrentUser, Principal, Public, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { walletCode } from '../ledger/postings';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { ReconciliationService } from './reconciliation.service';
import { BadRequestException } from '@nestjs/common';

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

/** Finance staff: approve payouts and watch reconciliation. Every change is written to the staff audit log. */
@Controller('admin')
@Roles('finance', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminPaymentsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly reconciliation: ReconciliationService,
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
