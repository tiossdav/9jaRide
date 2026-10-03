import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InfraModule } from './common/infra.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { LedgerModule } from './ledger/ledger.module';
import { SafetyModule } from './safety/safety.module';

@Module({
  imports: [ScheduleModule.forRoot(), InfraModule, LedgerModule, DispatchModule, SafetyModule],
})
export class AppModule {}
