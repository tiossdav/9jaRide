import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminPaymentsController, PaymentReturnController, WalletController, WebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PAYOUT_PROVIDER } from './payments.types';
import { PaystackClient } from './paystack.client';
import { PayoutsService } from './payouts.service';
import { ReconciliationService } from './reconciliation.service';

// Runs in the worker role. Payout sending is frequent and cheap; reconciliation is hourly.
@Injectable()
export class PaymentsWorker {
  private readonly log = new Logger(PaymentsWorker.name);
  constructor(private readonly payouts: PayoutsService, private readonly reconciliation: ReconciliationService) {}

  @Interval(30_000)
  async sendPayouts() {
    try {
      await this.payouts.sendApproved();
    } catch (e) {
      this.log.error(`payout send tick failed: ${e}`);
    }
  }

  @Cron('0 * * * *')
  async reconcile() {
    try {
      const r = await this.reconciliation.run();
      this.log.log(`reconciliation ${r.runId ?? 'skipped (another instance holds the lock)'}: recovered ${r.recovered}, findings ${r.findings}`);
    } catch (e) {
      this.log.error(`reconciliation failed: ${e}`);
    }
  }
}

// One client plays both provider roles. Without PAYSTACK_SECRET_KEY every call throws and every webhook fails
// its signature check, so an unconfigured environment can never credit or pay anything.
@Module({
  imports: [LedgerModule],
  controllers: [WalletController, WebhookController, PaymentReturnController, AdminPaymentsController],
  providers: [
    PaymentsService,
    PayoutsService,
    ReconciliationService,
    PaymentsWorker,
    { provide: PaystackClient, useFactory: () => new PaystackClient() },
    { provide: PAYMENT_PROVIDER, useExisting: PaystackClient },
    { provide: PAYOUT_PROVIDER, useExisting: PaystackClient },
  ],
  exports: [PaymentsService, PayoutsService, ReconciliationService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
