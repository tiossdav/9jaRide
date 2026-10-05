import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module';
import { LedgerModule } from '../ledger/ledger.module';
import { FareService } from './fare.service';
import { SettlementService } from './settlement.service';

@Module({
  imports: [LedgerModule, FleetModule],
  providers: [FareService, SettlementService],
  exports: [FareService, SettlementService],
})
export class FareModule {}
