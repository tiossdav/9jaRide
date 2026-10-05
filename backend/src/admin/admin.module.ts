import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsModule } from '../payments/payments.module';
import { NinModule } from '../nin/nin.module';
import { FilesModule } from '../files/files.module';
import { VehiclePlansModule } from '../vehicle-plans/vehicle-plans.module';
import { AdjustmentsService } from './adjustments.service';
import { AdminDriversController, AdminMoneyController, DriverApplicationController } from './admin.controller';
import { DriverApplicationsService } from './driver-applications.service';
import { PaymentExceptionsService } from './payment-exceptions.service';

@Module({
  imports: [AuthModule, LedgerModule, PaymentsModule, VehiclePlansModule, FilesModule, NinModule],
  controllers: [DriverApplicationController, AdminDriversController, AdminMoneyController],
  providers: [AdjustmentsService, DriverApplicationsService, PaymentExceptionsService],
})
export class AdminModule {}
