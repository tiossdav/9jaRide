import { Logger, Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FareModule } from '../fare/fare.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RidesController, AdminTripChecksController } from './rides.controller';
import { LocationService } from './location.service';
import { RidesService } from './rides.service';
import { SCHEDULE_NOTIFIER, ScheduleNotifier, ScheduledRidesService } from './scheduled-rides.service';
import { ScheduledRidesWorker } from './scheduled-rides.worker';

// Placeholder until push/SMS exist: logs instead of telling the rider.
const logNotifier: ScheduleNotifier = {
  systemCancelled: async (riderId, rideId, reason) => new Logger('ScheduleNotifier').warn(`[stub] rider ${riderId}: ride ${rideId} cancelled: ${reason}`),
};

@Module({
  imports: [DispatchModule, FareModule, LedgerModule],
  controllers: [RidesController, AdminTripChecksController],
  providers: [RidesService, LocationService, ScheduledRidesService, ScheduledRidesWorker, { provide: SCHEDULE_NOTIFIER, useValue: logNotifier }],
})
export class RidesModule {}
