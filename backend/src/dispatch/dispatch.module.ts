import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { PushService } from '../push/push.service';
import { DispatchService } from './dispatch.service';
import { DispatchWorker } from './dispatch.worker';
import { OFFER_NOTIFIER, OfferNotifier } from './dispatch.types';

/**
 * Tells the driver about a new booking by push, so the phone rings even when the app is closed. The rider hears about
 * "driver found" / "no driver" from the ride status itself (see PushService), so those two only log here.
 */
@Injectable()
class PushOfferNotifier implements OfferNotifier {
  private readonly log = new Logger('OfferNotifier');
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly push: PushService) {}

  async sendOffer(driverId: string, offer: { rideId: string; offerId: string; expiresAt: Date; pickupDistanceKm: number }) {
    this.log.log(`offer ${offer.offerId} -> driver ${driverId}`);
    if (!this.push.enabled) return;
    const r = (await this.pool.query(`SELECT r.pickup_address, u.full_name FROM rides r JOIN users u ON u.id = r.rider_id WHERE r.id = $1`, [offer.rideId])).rows[0];
    const rider = String(r?.full_name ?? 'Rider').split(' ')[0];
    const seconds = Math.max(5, Math.round((offer.expiresAt.getTime() - Date.now()) / 1000));
    await this.push.toUser(driverId, {
      type: 'offer', title: 'New booking', body: `${rider} is waiting at ${r?.pickup_address ?? 'the pickup point'}`,
      data: { rideId: offer.rideId, riderName: rider, pickup: r?.pickup_address ?? 'Pickup point', seconds: String(seconds), distanceKm: offer.pickupDistanceKm.toFixed(1) },
    }, 'driver');
  }

  async rideAssigned(riderId: string, driverId: string, rideId: string) { this.log.log(`ride ${rideId} assigned to ${driverId}, rider ${riderId}`); }
  async noDriverFound(riderId: string, rideId: string) { this.log.log(`no driver for ride ${rideId}, rider ${riderId}`); }
}

@Module({
  providers: [DispatchService, DispatchWorker, PushOfferNotifier, { provide: OFFER_NOTIFIER, useExisting: PushOfferNotifier }],
  exports: [DispatchService],
})
export class DispatchModule {}
