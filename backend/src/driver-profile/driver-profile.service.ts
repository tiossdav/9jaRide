import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { FilesService } from '../files/files.service';
import { FleetService } from '../fleet/fleet.service';
import { splitFare } from '../ledger/postings';
import { SettingsService } from '../settings/settings.service';
import { VehiclePlansService } from '../vehicle-plans/vehicle-plans.service';

/** What the driver app shows about the driver: what they gave at sign-up and onboarding, as the platform now holds it. */
@Injectable()
export class DriverProfileService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly files: FilesService,
    private readonly plans: VehiclePlansService,
    private readonly settings: SettingsService,
    private readonly fleet: FleetService,
  ) {}

  async profile(driverId: string) {
    const u = (await this.pool.query(`SELECT id, full_name, phone, status, avatar_file_id, created_at FROM users WHERE id = $1 AND role = 'driver'`, [driverId])).rows[0];
    if (!u) throw new NotFoundException('driver not found');
    // the approved application if there is one, otherwise the latest
    const a = (await this.pool.query(
      `SELECT * FROM driver_applications WHERE driver_id = $1 ORDER BY (status = 'APPROVED') DESC, created_at DESC LIMIT 1`, [driverId],
    )).rows[0];
    const v = (await this.pool.query(
      `SELECT v.id, v.category, v.make, v.colour, v.plate, v.arrangement, v.owner_name, v.owner_phone, t.label AS category_label
         FROM vehicles v LEFT JOIN asset_types t ON t.code = v.category WHERE v.driver_id = $1 AND v.active`, [driverId],
    )).rows[0];
    const r = (await this.pool.query(
      `SELECT round(avg(x.stars)::numeric, 1)::float8 AS avg, count(*)::int AS n FROM ride_ratings x JOIN rides r ON r.id = x.ride_id WHERE r.driver_id = $1`, [driverId],
    )).rows[0];
    const plan = await this.plans.forDriver(driverId);
    return {
      id: u.id, name: u.full_name, phone: u.phone, status: u.status, joinedAt: u.created_at, photoFileId: u.avatar_file_id,
      rating: r.avg, ratings: r.n,
      personal: a ? {
        email: a.email, contactPreference: a.contact_preference, dateOfBirth: a.date_of_birth, nin: a.nin, lassdri: a.lassdri_number, address: a.address,
        nextOfKin: { name: a.next_of_kin_name, phone: a.next_of_kin_phone, relationship: a.next_of_kin_relationship, address: a.next_of_kin_address },
      } : null,
      application: a ? { id: a.id, status: a.status, arrangement: a.arrangement } : null,
      vehicle: v ? {
        id: v.id, category: v.category, categoryLabel: v.category_label ?? v.category, make: v.make, colour: v.colour, plate: v.plate,
        arrangement: v.arrangement, owner: v.owner_name ? { name: v.owner_name, phone: v.owner_phone } : null,
      } : null,
      plan: plan ? { id: plan.id, status: plan.status, paidKobo: plan.paidKobo, outstandingKobo: plan.outstandingKobo, overdueKobo: plan.overdueKobo, nextDueOn: plan.nextDueOn, totalKobo: plan.terms.totalKobo } : null,
    };
  }

  async setPhoto(driverId: string, fileId: string): Promise<void> {
    if (!(await this.files.ownedBy(driverId, [fileId]))) throw new BadRequestException('that file is not yours or does not exist');
    await this.pool.query(`UPDATE users SET avatar_file_id = $2 WHERE id = $1`, [driverId, fileId]);
  }

  /** Finished trips, newest first, with what the driver kept from each, and today's totals (Lagos time). */
  async trips(driverId: string, limit = 30) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.payment_method, r.pickup_address, r.dropoff_address, r.created_at, COALESCE(r.promo_discount_kobo, 0)::bigint AS discount,
              f.total_kobo, f.tax_kobo, f.distance_m, f.duration_s, f.created_at AS finished_at, u.full_name AS rider, COALESCE(vd.amount_kobo, 0)::bigint AS vehicle_kobo,
              (f.created_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date AS today
         FROM rides r JOIN ride_fares f ON f.ride_id = r.id JOIN users u ON u.id = r.rider_id LEFT JOIN vehicle_deductions vd ON vd.ride_id = r.id
        WHERE r.driver_id = $1 AND r.status = 'TRIP_COMPLETED' ORDER BY f.created_at DESC LIMIT $2`,
      [driverId, Math.min(limit, 100)],
    );
    const items: any[] = [];
    for (const t of rows) {
      const rules = await this.settings.effective('revenue', t.created_at);
      const { commission, driverShare } = splitFare(Number(t.total_kobo), Number(t.tax_kobo), rules.commissionBps, rules.taxBase === 'included');
      items.push({
        id: t.id, code: t.short_code, at: t.finished_at, paymentMethod: t.payment_method, pickup: t.pickup_address, dropoff: t.dropoff_address, rider: t.rider.split(' ')[0],
        totalKobo: Number(t.total_kobo), taxKobo: Number(t.tax_kobo), commissionKobo: commission, earnedKobo: driverShare, vehicleDeductionKobo: Number(t.vehicle_kobo), keptKobo: driverShare - Number(t.vehicle_kobo), distanceM: t.distance_m, durationS: t.duration_s, today: t.today,
      });
    }
    const today = items.filter((i) => i.today);
    return {
      items,
      today: {
        trips: today.length, earnedKobo: today.reduce((n, i) => n + i.earnedKobo, 0), vehicleDeductionKobo: today.reduce((n, i) => n + i.vehicleDeductionKobo, 0), keptKobo: today.reduce((n, i) => n + i.keptKobo, 0), distanceM: today.reduce((n, i) => n + i.distanceM, 0), durationS: today.reduce((n, i) => n + i.durationS, 0),
      },
    };
  }

  // ------------------------------------------------------------------ settlement (the step after approval)

  /** What the settlement page shows: the payout account, the vehicle and how it is paid for, and whether the step is finished. */
  async settlement(driverId: string) {
    const acct = (await this.pool.query(`SELECT bank_name, account_number, account_name FROM driver_payout_accounts WHERE driver_id = $1`, [driverId])).rows[0];
    const done = (await this.pool.query(`SELECT settlement_done_at FROM users WHERE id = $1`, [driverId])).rows[0]?.settlement_done_at;
    const me = await this.profile(driverId);
    return {
      done: done != null,
      account: acct ? { bankName: acct.bank_name, accountNumber: acct.account_number, accountName: acct.account_name } : null,
      vehicle: me.vehicle,
      plan: me.plan,
      // how the vehicle is paid for: who set the share, and whether the driver can change it
      terms: await this.vehicleTerms(driverId, me.application?.arrangement ?? null, !!me.vehicle),
    };
  }

  /** The share of earnings that goes toward the vehicle, and who controls it. */
  private async vehicleTerms(driverId: string, arrangement: string | null, hasVehicle: boolean) {
    const t = await this.fleet.driverTerms(driverId);
    if (arrangement === 'business_vehicle') {
      return t ? { kind: 'business', setBy: t.setBy, canChange: false, percent: t.percent, owner: t.owner?.name ?? null, targetKobo: t.targetKobo, paidKobo: t.paidKobo }
        : { kind: 'business', setBy: 'owner', canChange: false, percent: null, owner: null, waiting: !hasVehicle };
    }
    if (arrangement === 'third_party' && t) return { kind: 'owner', setBy: t.setBy, canChange: t.canChange, percent: t.percent, owner: t.owner?.name ?? null, targetKobo: t.targetKobo, paidKobo: t.paidKobo };
    return { kind: 'own', setBy: 'driver', canChange: false, percent: 0 };
  }

  async saveAccount(driverId: string, a: { bankName: string; accountNumber: string; accountName: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO driver_payout_accounts (driver_id, bank_name, account_number, account_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_id) DO UPDATE SET bank_name = $2, account_number = $3, account_name = $4, updated_at = now()`,
      [driverId, a.bankName.trim(), a.accountNumber, a.accountName.trim()],
    );
  }

  /** Finishes the step. A driver who is not approved yet, or who has not given a payout account, cannot. */
  async completeSettlement(driverId: string): Promise<void> {
    const ok = await this.pool.query(
      `SELECT 1 FROM driver_applications a JOIN driver_payout_accounts p ON p.driver_id = a.driver_id WHERE a.driver_id = $1 AND a.status = 'APPROVED'`, [driverId],
    );
    if (!ok.rowCount) throw new BadRequestException('add your payout account first, once your profile is approved');
    await this.pool.query(`UPDATE users SET settlement_done_at = COALESCE(settlement_done_at, now()) WHERE id = $1`, [driverId]);
  }
}
