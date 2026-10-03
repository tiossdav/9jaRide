import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FareModule } from '../fare/fare.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [DispatchModule, FareModule, LedgerModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
