import { Logger, Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { DispatchWorker } from './dispatch.worker';
import { OFFER_NOTIFIER, OfferNotifier } from './dispatch.types';

// Placeholder until the Socket.IO gateway and FCM are built: logs instead of sending.
const logNotifier: OfferNotifier = (() => {
  const log = new Logger('OfferNotifier');
  return {
    sendOffer: async (driverId, offer) => log.log(`offer ${offer.offerId} -> driver ${driverId}`),
    rideAssigned: async (riderId, driverId, rideId) => log.log(`ride ${rideId} assigned to ${driverId}, rider ${riderId}`),
    noDriverFound: async (riderId, rideId) => log.log(`no driver for ride ${rideId}, rider ${riderId}`),
  };
})();

@Module({
  providers: [DispatchService, DispatchWorker, { provide: OFFER_NOTIFIER, useValue: logNotifier }],
  exports: [DispatchService],
})
export class DispatchModule {}
