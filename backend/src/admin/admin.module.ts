import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdjustmentsService } from './adjustments.service';
import { AdminDriversController, AdminMoneyController, DriverApplicationController } from './admin.controller';
import { DriverApplicationsService } from './driver-applications.service';
import { PaymentExceptionsService } from './payment-exceptions.service';

@Module({
  imports: [AuthModule, LedgerModule, PaymentsModule],
  controllers: [DriverApplicationController, AdminDriversController, AdminMoneyController],
  providers: [AdjustmentsService, DriverApplicationsService, PaymentExceptionsService],
})
export class AdminModule {}
