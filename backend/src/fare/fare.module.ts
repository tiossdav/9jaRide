import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { FareService } from './fare.service';
import { SettlementService } from './settlement.service';

@Module({
  imports: [LedgerModule],
  providers: [FareService, SettlementService],
  exports: [FareService, SettlementService],
})
export class FareModule {}
