import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './common/health.controller';
import { InfraModule } from './common/infra.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { FareModule } from './fare/fare.module';
import { LedgerModule } from './ledger/ledger.module';
import { PaymentsModule } from './payments/payments.module';
import { RidesModule } from './rides/rides.module';
import { SafetyModule } from './safety/safety.module';

@Module({
  controllers: [HealthController],
  imports: [ScheduleModule.forRoot(), InfraModule, AuthModule, LedgerModule, FareModule, PaymentsModule, DispatchModule, RidesModule, SafetyModule],
})
export class AppModule {}
