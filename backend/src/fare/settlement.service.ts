import { Injectable } from '@nestjs/common';
import { Measured } from './fare.calc';
import { FareService, StoredFare } from './fare.service';
import { LedgerService } from '../ledger/ledger.service';
import { PromoService } from '../promo/promo.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Completing a trip in ONE database transaction: freeze the fare, move the ride to TRIP_COMPLETED, and post the
 * ledger entries. Either all three commit or none do, so a ride can never be "completed" with no money moved,
 * and every step is idempotent so a retry after a crash is safe.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly fares: FareService, private readonly ledger: LedgerService, private readonly settings: SettingsService, private readonly promo: PromoService) {}

  async settleCompletedTrip(rideId: string, measured: Measured): Promise<StoredFare> {
    return this.ledger.withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT rider_id, driver_id, status, payment_method, created_at FROM rides WHERE id = $1 FOR UPDATE`,
        [rideId],
      );
      const ride = rows[0];
      if (!ride) throw new Error(`ride ${rideId} not found`);
      if (!ride.driver_id) throw new Error(`ride ${rideId} has no driver`);
      if (!['TRIP_STARTED', 'TRIP_COMPLETED'].includes(ride.status)) {
        throw new Error(`ride ${rideId} cannot be completed from status ${ride.status}`);
      }

      const fare = await this.fares.finalize(client, rideId, measured);

      const moved = await client.query(
        `UPDATE rides SET status = 'TRIP_COMPLETED', updated_at = now() WHERE id = $1 AND status = 'TRIP_STARTED'`,
        [rideId],
      );
      if (moved.rowCount) {
        await client.query(
          `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id) VALUES ($1, 'TRIP_STARTED', 'TRIP_COMPLETED', $2)`,
          [rideId, ride.driver_id],
        );
      }

      // The commission rules that applied when the ride was booked, so a later change never rewrites a trip in flight.
      const revenue = await this.settings.effective('revenue', ride.created_at, client);
      const discountKobo = await this.promo.settle(client, rideId, fare.totalKobo);
      const rules = { commissionBps: revenue.commissionBps, taxCommissionable: revenue.taxBase === 'included', discountKobo };

      // Both paths post under idempotency key `trip:<rideId>`, so replaying settlement cannot pay twice.
      if (ride.payment_method === 'wallet') {
        await this.ledger.completeWalletTrip(client, rideId, ride.rider_id, ride.driver_id, fare.totalKobo, fare.taxKobo, rules);
      } else {
        await this.ledger.completeCashTrip(client, rideId, ride.driver_id, fare.totalKobo, fare.taxKobo, rules);
      }
      return fare;
    });
  }
}
