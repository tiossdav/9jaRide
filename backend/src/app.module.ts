import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InfraModule } from './common/infra.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { FareModule } from './fare/fare.module';
import { LedgerModule } from './ledger/ledger.module';
import { PaymentsModule } from './payments/payments.module';
import { SafetyModule } from './safety/safety.module';

@Module({
  imports: [ScheduleModule.forRoot(), InfraModule, LedgerModule, FareModule, PaymentsModule, DispatchModule, SafetyModule],
})
export class AppModule {}
