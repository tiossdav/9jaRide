import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { normalisePlate } from '../common/plate';
import { FilesService } from '../files/files.service';
import { FileKind, VehicleRow, fileKind, parseCsv, parseXlsx, validateTable } from './fleet-import';

export const MAX_DEDUCTION_BPS = 9000;
export const ownerAccount = (ownerId: string) => `owner:${ownerId}`;

export interface Scope { businessId: string | null } // a business sees only its own vehicles; staff see all (null)

export interface AssignTerms { deductionBps: number; targetKobo?: number | null; setBy: 'driver' | 'owner' }

/** What came off a trip and why; null when nothing is taken. */
export interface Deduction { assignmentId: string; ownerId: string; amountKobo: number; bps: number; account: string }

@Injectable()
export class FleetService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis, private readonly files: FilesService) {}

  /** What this staff member may see: a business account only its own vehicles, everyone else all of them. */
  async scopeFor(p: { id: string; role: string }): Promise<Scope> {
    if (p.role !== 'business') return { businessId: null };
    const r = (await this.pool.query(`SELECT business_id FROM staff_users WHERE id = $1 AND active`, [p.id])).rows[0];
    if (!r?.business_id) throw new NotFoundException('no business is linked to this account');
    return { businessId: r.business_id };
  }

  /** Approved drivers, for choosing who gets a vehicle. Those without a vehicle come first. */
  async drivers(search?: string) {
    const args: unknown[] = []; let w = '';
    if (search?.trim()) { args.push(`%${search.trim()}%`); w = `AND (u.full_name ILIKE $1 OR u.phone ILIKE $1)`; }
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.phone, (SELECT a.id FROM vehicle_assignments a WHERE a.driver_id = u.id AND a.ended_at IS NULL) AS assignment_id,
              (SELECT v.plate FROM vehicles v WHERE v.driver_id = u.id AND v.active) AS plate
         FROM users u WHERE u.role = 'driver' AND u.status = 'active' AND EXISTS (SELECT 1 FROM driver_applications d WHERE d.driver_id = u.id AND d.status = 'APPROVED') ${w}
        ORDER BY (SELECT count(*) FROM vehicle_assignments a WHERE a.driver_id = u.id AND a.ended_at IS NULL), u.full_name LIMIT 25`, args,
    );
    return rows.map((r) => ({ id: r.id, name: r.full_name, phone: r.phone, hasVehicle: r.assignment_id != null, plate: r.plate }));
  }

  // ------------------------------------------------------------------ businesses

  async createBusiness(input: { name: string; contactName?: string; phone?: string; email?: string; defaultDeductionBps?: number }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query(
        `INSERT INTO businesses (name, contact_name, phone, email, default_deduction_bps) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.name.trim(), input.contactName?.trim() || null, input.phone?.trim() || null, input.email?.trim() || null, input.defaultDeductionBps ?? 2000],
      )).rows[0];
      await client.query(`INSERT INTO vehicle_owners (kind, name, phone, business_id) VALUES ('business', $1, $2, $3)`, [input.name.trim(), input.phone?.trim() || null, b.id]);
      await client.query('COMMIT');
      return { id: b.id as string };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (e?.code === '23505') throw new ConflictException('a business with that name already exists');
      throw e;
    } finally {
      client.release();
    }
  }

  async listBusinesses(scope: Scope = { businessId: null }) {
    const { rows } = await this.pool.query(
      `SELECT b.*, (SELECT count(*)::int FROM fleet_vehicles f WHERE f.business_id = b.id AND f.status <> 'retired') AS vehicles,
              (SELECT count(*)::int FROM vehicle_assignments a JOIN vehicle_owners o ON o.id = a.owner_id WHERE o.business_id = b.id AND a.ended_at IS NULL) AS drivers,
              COALESCE((SELECT sum(d.amount_kobo) FROM vehicle_deductions d JOIN vehicle_owners o ON o.id = d.owner_id WHERE o.business_id = b.id), 0)::bigint AS collected
         FROM businesses b ${scope.businessId ? 'WHERE b.id = $1' : ''} ORDER BY b.name`, scope.businessId ? [scope.businessId] : [],
    );
    return rows.map((b) => ({ id: b.id, name: b.name, contactName: b.contact_name, phone: b.phone, email: b.email, defaultDeductionBps: b.default_deduction_bps, status: b.status, vehicles: b.vehicles, drivers: b.drivers, collectedKobo: Number(b.collected) }));
  }

  /** The people who can sign in for a business. */
  async businessUsers(businessId: string) {
    const { rows } = await this.pool.query(`SELECT id, full_name, email, active, last_login_at, must_change_password FROM staff_users WHERE business_id = $1 ORDER BY created_at`, [businessId]);
    return rows.map((u) => ({ id: u.id, name: u.full_name, email: u.email, active: u.active, lastLoginAt: u.last_login_at, pendingFirstLogin: u.must_change_password && !u.last_login_at }));
  }

  private async ownerOfBusiness(client: Pool | PoolClient, businessId: string): Promise<string> {
    const r = (await client.query(`SELECT o.id FROM vehicle_owners o JOIN businesses b ON b.id = o.business_id WHERE b.id = $1 AND b.status = 'active'`, [businessId])).rows[0];
    if (!r) throw new NotFoundException('business not found, or it is suspended');
    return r.id;
  }

  // ------------------------------------------------------------------ the vehicle list

  private async categoryMap(): Promise<Map<string, string>> {
    const { rows } = await this.pool.query(`SELECT code, label FROM asset_types WHERE active`);
    const m = new Map<string, string>();
    for (const r of rows) { m.set(String(r.code).toLowerCase(), r.code); m.set(String(r.label).toLowerCase(), r.code); }
    return m;
  }

  async create(input: { businessId: string; plate: string; makeModel: string; colour: string; category: string; year?: number | null; vin?: string; notes?: string }, actorId: string) {
    const plate = normalisePlate(input.plate);
    if (!/^[A-Z0-9]{5,10}$/.test(plate)) throw new BadRequestException('the plate number must be 5 to 10 letters and digits');
    const cat = await this.pool.query(`SELECT active FROM asset_types WHERE code = $1`, [input.category]);
    if (!cat.rows[0]?.active) throw new BadRequestException('choose a category that is switched on');
    const ownerId = await this.ownerOfBusiness(this.pool, input.businessId);
    if ((await this.pool.query(`SELECT 1 FROM vehicles WHERE plate = $1`, [plate])).rowCount) throw new ConflictException({ code: 'plate_in_use', message: 'that plate is already registered' });
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO fleet_vehicles (owner_id, business_id, plate, make_model, colour, category, model_year, vin, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [ownerId, input.businessId, plate, input.makeModel.trim(), input.colour.trim(), input.category, input.year ?? null, input.vin?.trim() || null, input.notes?.trim() || null, actorId],
      );
      return { id: rows[0].id as string };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ code: 'plate_in_use', message: 'that plate is already registered' });
      throw e;
    }
  }

  /**
   * Imports a list of vehicles from a CSV or Excel file for one business. With dryRun it only checks and reports, so the
   * person can fix the file first; otherwise every good line is saved and the bad ones are returned with the reason.
   */
  async importFile(businessId: string, file: { buffer: Buffer; name: string }, dryRun: boolean, actorId: string) {
    const kind: FileKind | null = fileKind(file.buffer, file.name);
    if (!kind) throw new BadRequestException('send a CSV or Excel (.xlsx) file');
    const ownerId = await this.ownerOfBusiness(this.pool, businessId);
    let table: string[][];
    try { table = kind === 'xlsx' ? await parseXlsx(file.buffer) : parseCsv(file.buffer.toString('utf8')); } catch { throw new BadRequestException('that file could not be read'); }
    const known = new Set<string>((await this.pool.query(`SELECT plate FROM fleet_vehicles UNION SELECT plate FROM vehicles`)).rows.map((r) => r.plate));
    const { rows, errors, headerProblem } = validateTable(table, await this.categoryMap(), known);
    if (headerProblem) throw new BadRequestException({ code: 'bad_file', message: headerProblem });

    let saved = 0;
    if (!dryRun && rows.length) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        for (const r of rows) {
          const res = await client.query(
            `INSERT INTO fleet_vehicles (owner_id, business_id, plate, make_model, colour, category, model_year, vin, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (plate) DO NOTHING`,
            [ownerId, businessId, r.plate, r.makeModel, r.colour, r.category, r.year, r.vin, r.notes, actorId],
          );
          if (res.rowCount) saved++; else errors.push({ row: r.row, plate: r.plate, message: 'This plate was added by someone else a moment ago.' });
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    }
    errors.sort((a, b) => a.row - b.row);
    return { dryRun, lines: rows.length + errors.length, valid: dryRun ? rows.length : saved, imported: dryRun ? 0 : saved, rejected: errors.length, errors };
  }

  async list(scope: Scope, q: { search?: string; status?: string; category?: string; businessId?: string; available?: boolean; page?: number }) {
    const where: string[] = []; const args: unknown[] = [];
    const biz = scope.businessId ?? q.businessId;
    if (biz) { args.push(biz); where.push(`f.business_id = $${args.length}`); }
    if (q.status && q.status !== 'all') { args.push(q.status); where.push(`f.status = $${args.length}`); }
    if (q.category) { args.push(q.category); where.push(`f.category = $${args.length}`); }
    if (q.available) where.push(`f.status = 'verified' AND NOT EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.fleet_vehicle_id = f.id AND a.ended_at IS NULL)`);
    if (q.search?.trim()) {
      args.push(`%${q.search.trim()}%`, `%${normalisePlate(q.search)}%`);
      where.push(`(f.make_model ILIKE $${args.length - 1} OR f.colour ILIKE $${args.length - 1} OR b.name ILIKE $${args.length - 1} OR ($${args.length} <> '%%' AND f.plate LIKE $${args.length}))`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, q.page ?? 1);
    const base = `FROM fleet_vehicles f LEFT JOIN businesses b ON b.id = f.business_id LEFT JOIN vehicle_assignments a ON a.fleet_vehicle_id = f.id AND a.ended_at IS NULL LEFT JOIN users d ON d.id = a.driver_id`;
    const total = (await this.pool.query(`SELECT count(*)::int AS n ${base} ${w}`, args)).rows[0].n;
    const { rows } = await this.pool.query(
      `SELECT f.id, f.plate, f.make_model, f.colour, f.category, f.model_year, f.status, b.id AS business_id, b.name AS business, d.id AS driver_id, d.full_name AS driver, a.deduction_bps,
              (SELECT file_id FROM fleet_vehicle_images i WHERE i.fleet_vehicle_id = f.id ORDER BY i.position, i.created_at LIMIT 1) AS photo
         ${base} ${w} ORDER BY f.created_at DESC LIMIT 25 OFFSET ${(page - 1) * 25}`, args,
    );
    const counts = (await this.pool.query(
      `SELECT count(*) FILTER (WHERE f.status <> 'retired')::int AS total, count(*) FILTER (WHERE f.status = 'pending')::int AS pending,
              count(*) FILTER (WHERE f.status = 'verified' AND a.id IS NULL)::int AS available, count(*) FILTER (WHERE a.id IS NOT NULL)::int AS assigned
         FROM fleet_vehicles f LEFT JOIN vehicle_assignments a ON a.fleet_vehicle_id = f.id AND a.ended_at IS NULL ${biz ? 'WHERE f.business_id = $1' : ''}`, biz ? [biz] : [],
    )).rows[0];
    return {
      total, page, pageSize: 25, counts,
      items: rows.map((r) => ({
        id: r.id, plate: r.plate, makeModel: r.make_model, colour: r.colour, category: r.category, year: r.model_year, status: r.status, photoFileId: r.photo,
        business: r.business_id ? { id: r.business_id, name: r.business } : null, driver: r.driver_id ? { id: r.driver_id, name: r.driver } : null, deductionBps: r.deduction_bps,
        available: r.status === 'verified' && !r.driver_id,
      })),
    };
  }

  private async mustSee(scope: Scope, id: string) {
    const f = (await this.pool.query(`SELECT * FROM fleet_vehicles WHERE id = $1`, [id])).rows[0];
    if (!f || (scope.businessId && f.business_id !== scope.businessId)) throw new NotFoundException('vehicle not found');
    return f;
  }

  async get(scope: Scope, id: string) {
    const f = await this.mustSee(scope, id);
    const images = (await this.pool.query(`SELECT id, file_id FROM fleet_vehicle_images WHERE fleet_vehicle_id = $1 ORDER BY position, created_at`, [id])).rows;
    const history = (await this.pool.query(
      `SELECT a.id, a.started_at, a.ended_at, a.ended_reason, a.deduction_bps, a.target_kobo, a.deduction_set_by, d.id AS driver_id, d.full_name AS driver,
              COALESCE((SELECT sum(x.amount_kobo) FROM vehicle_deductions x WHERE x.assignment_id = a.id), 0)::bigint AS paid_kobo
         FROM vehicle_assignments a JOIN users d ON d.id = a.driver_id WHERE a.fleet_vehicle_id = $1 ORDER BY a.started_at DESC`, [id],
    )).rows;
    const biz = f.business_id ? (await this.pool.query(`SELECT id, name, default_deduction_bps FROM businesses WHERE id = $1`, [f.business_id])).rows[0] : null;
    const live = history.find((h) => !h.ended_at);
    return {
      id: f.id, plate: f.plate, makeModel: f.make_model, colour: f.colour, category: f.category, year: f.model_year, vin: f.vin, notes: f.notes, status: f.status, verifiedAt: f.verified_at,
      business: biz ? { id: biz.id, name: biz.name, defaultDeductionBps: biz.default_deduction_bps } : null,
      images: images.map((i) => ({ id: i.id, fileId: i.file_id })),
      available: f.status === 'verified' && !live,
      history: history.map((h) => ({
        id: h.id, driver: { id: h.driver_id, name: h.driver }, startedAt: h.started_at, endedAt: h.ended_at, endedReason: h.ended_reason,
        deductionBps: h.deduction_bps, targetKobo: h.target_kobo == null ? null : Number(h.target_kobo), setBy: h.deduction_set_by, paidKobo: Number(h.paid_kobo),
      })),
    };
  }

  /** Verify, suspend or retire. A vehicle can only be given to a driver once it is verified. */
  async setStatus(scope: Scope, id: string, status: 'verified' | 'suspended' | 'retired', actorId: string) {
    const f = await this.mustSee(scope, id);
    if (status === 'retired' && (await this.pool.query(`SELECT 1 FROM vehicle_assignments WHERE fleet_vehicle_id = $1 AND ended_at IS NULL`, [id])).rowCount) {
      throw new ConflictException({ code: 'in_use', message: 'a driver has this vehicle; end the assignment first' });
    }
    if (f.status === status) return;
    await this.pool.query(
      `UPDATE fleet_vehicles SET status = $2, verified_by = CASE WHEN $2 = 'verified' THEN $3::uuid ELSE verified_by END, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END, updated_at = now() WHERE id = $1`,
      [id, status, actorId],
    );
  }

  async addImage(scope: Scope, id: string, fileId: string, actorId: string) {
    await this.mustSee(scope, id);
    if (!(await this.files.ownedBy(actorId, [fileId]))) throw new BadRequestException('that file was not uploaded by you');
    const n = (await this.pool.query(`SELECT count(*)::int AS n FROM fleet_vehicle_images WHERE fleet_vehicle_id = $1`, [id])).rows[0].n;
    if (n >= 8) throw new ConflictException({ code: 'too_many', message: 'a vehicle can have up to 8 pictures' });
    await this.pool.query(`INSERT INTO fleet_vehicle_images (fleet_vehicle_id, file_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, fileId, n]);
  }

  async removeImage(scope: Scope, id: string, imageId: string) {
    await this.mustSee(scope, id);
    await this.pool.query(`DELETE FROM fleet_vehicle_images WHERE id = $1 AND fleet_vehicle_id = $2`, [imageId, id]);
  }

  // ------------------------------------------------------------------ giving a vehicle to a driver

  /** Inside someone else's transaction (approval uses this). The vehicle must be verified and free; the driver must have none. */
  async assignInTx(client: PoolClient, fleetVehicleId: string, driverId: string, terms: AssignTerms, actorId: string | null): Promise<{ assignmentId: string; vehicleId: string }> {
    if (!Number.isInteger(terms.deductionBps) || terms.deductionBps < 0 || terms.deductionBps > MAX_DEDUCTION_BPS) throw new BadRequestException(`the share must be between 0% and ${MAX_DEDUCTION_BPS / 100}%`);
    const f = (await client.query(`SELECT * FROM fleet_vehicles WHERE id = $1 FOR UPDATE`, [fleetVehicleId])).rows[0];
    if (!f) throw new NotFoundException('vehicle not found');
    if (f.status !== 'verified') throw new ConflictException({ code: 'not_verified', message: 'this vehicle has not been verified, so it cannot be given to a driver' });
    if ((await client.query(`SELECT 1 FROM vehicle_assignments WHERE fleet_vehicle_id = $1 AND ended_at IS NULL`, [fleetVehicleId])).rowCount) {
      throw new ConflictException({ code: 'already_assigned', message: 'this vehicle is already with a driver' });
    }
    const driver = (await client.query(`SELECT id, status FROM users WHERE id = $1 AND role = 'driver' FOR UPDATE`, [driverId])).rows[0];
    if (!driver) throw new NotFoundException('driver not found');
    if (driver.status !== 'active') throw new ConflictException({ code: 'driver_suspended', message: 'that driver is suspended' });

    // the driver's earlier vehicle stops being theirs, and its assignment ends
    await client.query(`UPDATE vehicle_assignments SET ended_at = now(), ended_reason = 'replaced by another vehicle' WHERE driver_id = $1 AND ended_at IS NULL`, [driverId]);
    await client.query(`UPDATE vehicles SET active = false WHERE driver_id = $1 AND active`, [driverId]);
    // one live record per plate: a vehicle that has had drivers before is handed on, not duplicated
    const v = (await client.query(
      `INSERT INTO vehicles (driver_id, category, make, colour, plate, arrangement, owner_name, active)
       VALUES ($1, $2, $3, $4, $5, 'business_vehicle', (SELECT name FROM vehicle_owners WHERE id = $6), true)
       ON CONFLICT (plate) DO UPDATE SET driver_id = $1, category = $2, make = $3, colour = $4, arrangement = 'business_vehicle', owner_name = EXCLUDED.owner_name, active = true, suspended_at = NULL, suspended_reason = NULL
       RETURNING id`,
      [driverId, f.category, f.make_model, f.colour, f.plate, f.owner_id],
    )).rows[0];
    await client.query(`UPDATE fleet_vehicles SET vehicle_id = $2, updated_at = now() WHERE id = $1`, [fleetVehicleId, v.id]);
    let a;
    try {
      a = (await client.query(
        `INSERT INTO vehicle_assignments (driver_id, vehicle_id, fleet_vehicle_id, owner_id, deduction_bps, target_kobo, deduction_set_by, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [driverId, v.id, fleetVehicleId, f.owner_id, terms.deductionBps, terms.targetKobo ?? null, terms.setBy, actorId],
      )).rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ code: 'already_assigned', message: 'this vehicle is already with a driver' });
      throw e;
    }
    return { assignmentId: a.id, vehicleId: v.id };
  }

  async assign(scope: Scope, fleetVehicleId: string, driverId: string, terms: Omit<AssignTerms, 'setBy'>, actorId: string) {
    await this.mustSee(scope, fleetVehicleId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // a driver must have passed review before being given a vehicle
      if (!(await client.query(`SELECT 1 FROM driver_applications WHERE driver_id = $1 AND status = 'APPROVED'`, [driverId])).rowCount) {
        throw new ConflictException({ code: 'not_approved', message: 'that driver has not been approved yet' });
      }
      const out = await this.assignInTx(client, fleetVehicleId, driverId, { ...terms, setBy: 'owner' }, actorId);
      await client.query('COMMIT');
      await this.redis.del(`driver:${driverId}:category`);
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async endAssignment(scope: Scope, assignmentId: string, reason: string) {
    const a = (await this.pool.query(`SELECT a.*, f.business_id FROM vehicle_assignments a LEFT JOIN fleet_vehicles f ON f.id = a.fleet_vehicle_id WHERE a.id = $1`, [assignmentId])).rows[0];
    if (!a || (scope.businessId && a.business_id !== scope.businessId)) throw new NotFoundException('assignment not found');
    if (a.ended_at) throw new ConflictException({ code: 'wrong_state', message: 'that assignment has already ended' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE vehicle_assignments SET ended_at = now(), ended_reason = $2 WHERE id = $1`, [assignmentId, reason]);
      await client.query(`UPDATE vehicles SET active = false WHERE id = $1`, [a.vehicle_id]); // the driver has no vehicle until they are given another
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    await this.redis.del(`driver:${a.driver_id}:category`);
  }

  // ------------------------------------------------------------------ taking the share from a trip

  /**
   * What comes off this driver's earnings for the trip being settled, if they drive a vehicle with a deduction. The row is
   * locked so two trips finishing together cannot together pass the target. The owner's ledger account is made if needed.
   */
  async deductionFor(client: PoolClient, driverId: string, driverShareKobo: number): Promise<Deduction | null> {
    if (driverShareKobo <= 0) return null;
    const a = (await client.query(
      `SELECT a.id, a.owner_id, a.deduction_bps, a.target_kobo, COALESCE((SELECT sum(d.amount_kobo) FROM vehicle_deductions d WHERE d.assignment_id = a.id), 0)::bigint AS paid
         FROM vehicle_assignments a WHERE a.driver_id = $1 AND a.ended_at IS NULL AND a.deduction_bps > 0 AND a.owner_id IS NOT NULL AND a.agreement_accepted_at IS NOT NULL FOR UPDATE OF a`, [driverId],
    )).rows[0];
    if (!a) return null;
    let amount = Math.floor((driverShareKobo * a.deduction_bps) / 10_000);
    if (a.target_kobo != null) amount = Math.min(amount, Number(a.target_kobo) - Number(a.paid)); // stops when the vehicle is paid for
    if (amount <= 0) return null;
    const account = ownerAccount(a.owner_id);
    await client.query(`INSERT INTO ledger_accounts (code, kind) VALUES ($1, 'owner') ON CONFLICT (code) DO NOTHING`, [account]);
    return { assignmentId: a.id, ownerId: a.owner_id, amountKobo: amount, bps: a.deduction_bps, account };
  }

  async recordDeduction(client: PoolClient, rideId: string, driverId: string, driverShareKobo: number, d: Deduction): Promise<void> {
    await client.query(
      `INSERT INTO vehicle_deductions (ride_id, assignment_id, owner_id, driver_id, bps, driver_share_kobo, amount_kobo) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ride_id) DO NOTHING`,
      [rideId, d.assignmentId, d.ownerId, driverId, d.bps, driverShareKobo, d.amountKobo],
    );
  }

  // ------------------------------------------------------------------ the driver's own view

  async driverTerms(driverId: string) {
    const a = (await this.pool.query(
      `SELECT a.id, a.deduction_bps, a.target_kobo, a.deduction_set_by, a.started_at, a.agreement_accepted_at, o.name AS owner, o.kind AS owner_kind, o.phone AS owner_phone, v.plate,
              COALESCE((SELECT sum(d.amount_kobo) FROM vehicle_deductions d WHERE d.assignment_id = a.id), 0)::bigint AS paid
         FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN vehicle_owners o ON o.id = a.owner_id WHERE a.driver_id = $1 AND a.ended_at IS NULL`, [driverId],
    )).rows[0];
    if (!a) return null;
    return {
      assignmentId: a.id, bps: a.deduction_bps, percent: a.deduction_bps / 100, setBy: a.deduction_set_by,
      // a share to an owner is only taken, and the driver only goes online, once the driver has agreed to it
      accepted: a.agreement_accepted_at != null || a.owner == null, agreementPending: a.owner != null && a.agreement_accepted_at == null,
      canChange: a.deduction_set_by === 'driver' && a.owner != null, // a share chosen by a business cannot be changed by the driver
      owner: a.owner ? { name: a.owner, kind: a.owner_kind, phone: a.owner_phone } : null, plate: a.plate,
      targetKobo: a.target_kobo == null ? null : Number(a.target_kobo), paidKobo: Number(a.paid),
      remainingKobo: a.target_kobo == null ? null : Math.max(0, Number(a.target_kobo) - Number(a.paid)),
    };
  }

  /**
   * The driver agrees to the arrangement for the vehicle they have. When the share is theirs to choose they may set it in the
   * same step; when a business set it, they can only accept it as it is. Safe to repeat.
   */
  async acceptAgreement(driverId: string, bps?: number) {
    const a = (await this.pool.query(`SELECT id, deduction_set_by, owner_id, deduction_bps, agreement_accepted_at FROM vehicle_assignments WHERE driver_id = $1 AND ended_at IS NULL`, [driverId])).rows[0];
    if (!a) throw new NotFoundException('you do not have a vehicle assigned');
    if (!a.owner_id) return this.driverTerms(driverId); // your own vehicle: nothing to agree to
    let share: number = a.deduction_bps;
    if (bps !== undefined && bps !== a.deduction_bps) {
      if (a.deduction_set_by !== 'driver') throw new ConflictException({ code: 'set_by_owner', message: 'the owner of this vehicle sets this share, so you cannot change it' });
      if (!Number.isInteger(bps) || bps < 100 || bps > MAX_DEDUCTION_BPS) throw new BadRequestException(`the share must be between 1% and ${MAX_DEDUCTION_BPS / 100}%`);
      share = bps;
    }
    await this.pool.query(`UPDATE vehicle_assignments SET deduction_bps = $2, agreed_bps = $2, agreement_accepted_at = COALESCE(agreement_accepted_at, now()) WHERE id = $1`, [a.id, share]);
    await this.redis.del(`driver:${driverId}:category`);
    return this.driverTerms(driverId);
  }

  /** Only a share the driver chose themselves can be changed by them, and only for the next trips, never the past. */
  async setDriverShare(driverId: string, bps: number) {
    if (!Number.isInteger(bps) || bps < 100 || bps > MAX_DEDUCTION_BPS) throw new BadRequestException(`the share must be between 1% and ${MAX_DEDUCTION_BPS / 100}%`);
    const a = (await this.pool.query(`SELECT id, deduction_set_by, owner_id FROM vehicle_assignments WHERE driver_id = $1 AND ended_at IS NULL`, [driverId])).rows[0];
    if (!a) throw new NotFoundException('you do not have a vehicle assigned');
    if (a.deduction_set_by !== 'driver' || !a.owner_id) throw new ConflictException({ code: 'set_by_owner', message: 'the owner of this vehicle sets this share, so you cannot change it' });
    await this.pool.query(`UPDATE vehicle_assignments SET deduction_bps = $2 WHERE id = $1`, [a.id, bps]);
  }

  // ------------------------------------------------------------------ reports

  /** What each owner has been paid out of drivers' earnings, and how many drivers are paying toward their vehicles. */
  async ownerBalances(scope: Scope) {
    const { rows } = await this.pool.query(
      `SELECT o.id, o.name, o.kind, b.id AS business_id,
              COALESCE((SELECT sum(d.amount_kobo) FROM vehicle_deductions d WHERE d.owner_id = o.id), 0)::bigint AS collected,
              (SELECT count(*)::int FROM vehicle_assignments a WHERE a.owner_id = o.id AND a.ended_at IS NULL) AS drivers
         FROM vehicle_owners o LEFT JOIN businesses b ON b.id = o.business_id ${scope.businessId ? 'WHERE b.id = $1' : ''} ORDER BY collected DESC, o.name LIMIT 200`, scope.businessId ? [scope.businessId] : [],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, businessId: r.business_id, collectedKobo: Number(r.collected), drivers: r.drivers }));
  }
}
