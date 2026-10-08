import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PushService } from '../push/push.service';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { suspendedKey } from '../auth/auth.guard';
import { ACCESS_TOKEN_SECONDS } from '../auth/auth.types';
import { normalisePhone } from '../auth/phone';
import { TokensService } from '../auth/tokens.service';
import { PG_POOL, REDIS } from '../common/infra.module';
import { normalisePlate, parsePlate } from '../common/plate';
import { IdentifierKind, claimIdentifiers, identifierAvailable } from '../common/identifiers';
import { keys } from '../dispatch/dispatch.types';
import { FilesService } from '../files/files.service';
import { FleetService, MAX_DEDUCTION_BPS } from '../fleet/fleet.service';
import { NinService } from '../nin/nin.service';
import { PlanTerms, VehiclePlansService } from '../vehicle-plans/vehicle-plans.service';

export const DOCUMENT_KINDS = ['drivers_licence', 'nin', 'lassdri', 'vehicle_papers', 'vehicle_photo', 'road_worthiness', 'selfie'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** What staff can ask a driver to fix: a part of the form, or one document (selfie is the driver photo). */
export const CHANGE_ITEMS: string[] = ['about_you', 'next_of_kin', 'vehicle', ...DOCUMENT_KINDS];
/** A driver can ask for these two. Staff may confirm a different one after seeing the vehicle. */
export const REQUESTABLE_CATEGORIES = ['regular', 'comfort'];

/**
 * What must be on file before approval, by arrangement. A platform vehicle's papers and insurance are the platform's, so
 * the driver only proves who they are; a car owned by someone else also needs that owner's permission.
 */
export function requiredDocuments(arrangement: string): DocumentKind[] {
  // the NIN is checked by a verification service, so no photo of it is asked for
  // the driver's own photo ("selfie") is how riders and staff recognise them
  const person: DocumentKind[] = ['selfie', 'drivers_licence', 'lassdri'];
  // a business supplies the vehicle and answers for it, so the driver only proves who they are
  if (arrangement === 'platform_plan' || arrangement === 'business_vehicle') return person;
  const car: DocumentKind[] = [...person, 'vehicle_photo'];
  return car;
}
const NEEDS_EXPIRY: DocumentKind[] = ['drivers_licence', 'road_worthiness'];

export interface Personal {
  email: string;
  contactPreference: 'whatsapp' | 'email';
  dateOfBirth?: string;
  nin: string;
  lassdri: string;
  address: string;
  nextOfKin: { name: string; phone: string; relationship?: string; address: string };
}

export interface ApplicationInput {
  /** A code from vehicle_arrangements; "own" when the app does not say. */
  arrangement?: string;
  /** Make, colour and plate are only asked for when the arrangement needs them; the category is the one the driver wants. */
  vehicle: { category: string; make?: string; colour?: string; plate?: string };
  owner?: { name: string; phone: string };
  /** For someone else's car: the share of earnings that goes toward it, in basis points (2000 = 20%). */
  deductionBps?: number;
  personal: Personal;
  documents: { kind: DocumentKind; number?: string; fileId: string; expiresOn?: string }[];
}


/** What staff supply when approving a platform vehicle: which car the driver gets and on what terms. */
export interface Assignment {
  vehicle: { category: string; make: string; colour: string; plate: string };
  plan: PlanTerms;
}

@Injectable()
export class DriverApplicationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokensService,
    private readonly plans: VehiclePlansService,
    private readonly files: FilesService,
    private readonly nin: NinService,
    private readonly fleet: FleetService,
    @Optional() private readonly push?: PushService,
  ) {}

  /** The ways a driver can come by a car, for the sign-up screen. */
  async arrangements() {
    const { rows } = await this.pool.query(`SELECT code, name, description, needs_vehicle_details, needs_owner_details, needs_plan FROM vehicle_arrangements WHERE active ORDER BY sort_order`);
    return rows.map((r) => ({ code: r.code, name: r.name, description: r.description, asksForVehicle: r.needs_vehicle_details, asksForOwner: r.needs_owner_details, hasPaymentPlan: r.needs_plan }));
  }

  // ------------------------------------------------------------------ driver side

  /** Submit, or resubmit after staff asked for changes. A driver can have one open application at a time. */
  async submit(driverId: string, input: ApplicationInput): Promise<{ id: string }> {
    const arr = (await this.pool.query(`SELECT * FROM vehicle_arrangements WHERE code = $1 AND active`, [input.arrangement ?? 'own'])).rows[0];
    if (!arr) throw new BadRequestException('choose how you will get your vehicle');
    if (!REQUESTABLE_CATEGORIES.includes(input.vehicle.category)) throw new BadRequestException('choose Regular or Comfort');

    let plate: string | null = null;
    let make: string | null = null;
    let colour: string | null = null;
    if (arr.needs_vehicle_details) {
      plate = parsePlate(input.vehicle.plate ?? '');
      make = input.vehicle.make?.trim() ?? '';
      colour = input.vehicle.colour?.trim() ?? '';
      if (make.length < 2 || colour.length < 2) throw new BadRequestException('enter the model and colour of the vehicle');
    }
    let ownerName: string | null = null;
    let ownerPhone: string | null = null;
    if (arr.needs_owner_details) {
      ownerName = input.owner?.name?.trim() ?? '';
      ownerPhone = normalisePhone(input.owner?.phone ?? '');
      if (ownerName.length < 2) throw new BadRequestException("enter the owner's name");
      if (!ownerPhone) throw new BadRequestException("enter the owner's phone number");
      if (!Number.isInteger(input.deductionBps) || input.deductionBps! < 100 || input.deductionBps! > MAX_DEDUCTION_BPS) throw new BadRequestException(`say what share of your earnings goes toward the car (1% to ${MAX_DEDUCTION_BPS / 100}%)`);
    }

    const p = input.personal;
    const email = p.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new BadRequestException('enter a valid email address');
    if (!/^\d{11}$/.test(p.nin.trim())) throw new BadRequestException('the NIN is 11 digits');
    if (p.lassdri.trim().length < 4) throw new BadRequestException('enter your LASDRI number');
    if (p.address.trim().length < 5) throw new BadRequestException('enter your home address');
    const kinPhone = normalisePhone(p.nextOfKin.phone);
    if (p.nextOfKin.name.trim().length < 2 || !kinPhone || p.nextOfKin.address.trim().length < 5) throw new BadRequestException("enter your next of kin's name, phone number and address");
    if (p.dateOfBirth && new Date(p.dateOfBirth) > new Date(Date.now() - 18 * 365.25 * 86_400_000)) throw new BadRequestException('drivers must be at least 18');

    const kinds = new Set<string>();
    for (const d of input.documents) {
      if (kinds.has(d.kind)) throw new BadRequestException(`document ${d.kind} was sent twice`);
      kinds.add(d.kind);
      if (NEEDS_EXPIRY.includes(d.kind) && !d.expiresOn) throw new BadRequestException(`${d.kind} needs an expiry date`);
      if (d.kind === 'drivers_licence' && !d.number?.trim()) throw new BadRequestException('enter the driver licence number');
    }
    if (!(await this.files.ownedBy(driverId, input.documents.map((d) => d.fileId)))) throw new BadRequestException('one of the uploaded files is not yours or does not exist');
    const photo = input.documents.find((d) => d.kind === 'selfie');
    if (photo) {
      const m = (await this.pool.query(`SELECT mime_type FROM uploaded_files WHERE id = $1`, [photo.fileId])).rows[0]?.mime_type as string | undefined;
      if (!m?.startsWith('image/')) throw new BadRequestException('the driver photo must be a picture (JPG or PNG)');
    }

    // The NIN is checked before anything is saved: a wrong number is the driver's to fix now, not a reviewer's to chase later.
    const who = (await this.pool.query(`SELECT full_name FROM users WHERE id = $1`, [driverId])).rows[0]?.full_name ?? '';
    const ninCheck = await this.nin.check({ nin: p.nin.trim(), fullName: who, dateOfBirth: p.dateOfBirth });
    if (ninCheck.status === 'failed') throw new BadRequestException({ code: 'nin_failed', message: ninCheck.reason ?? 'We could not verify that NIN.' });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query(`SELECT role, status FROM users WHERE id = $1 FOR UPDATE`, [driverId]);
      if (user.rows[0]?.role !== 'driver') throw new BadRequestException('only drivers can apply');
      // The NIN, LASDRI number and licence number belong to one driver each. A refusal rolls everything back, so what the driver typed is
      // never half saved, and the app keeps the rest of the form.
      await claimIdentifiers(client, driverId, {
        nin: p.nin, lassdri: p.lassdri, drivers_licence: input.documents.find((d) => d.kind === 'drivers_licence')?.number,
      });

      const open = await client.query(
        `SELECT id, status FROM driver_applications WHERE driver_id = $1 AND status IN ('SUBMITTED', 'CHANGES_REQUESTED')`,
        [driverId],
      );
      const cols = [
        input.vehicle.category, make, colour, plate, arr.code, ownerName, ownerPhone,
        email, p.contactPreference, p.dateOfBirth ?? null, p.nin.trim(), p.lassdri.trim().toUpperCase(), p.address.trim(),
        p.nextOfKin.name.trim(), kinPhone, p.nextOfKin.relationship?.trim() || null, p.nextOfKin.address.trim(),
        ninCheck.status, ninCheck.reason ?? null, ninCheck.reference ?? null, arr.needs_owner_details ? input.deductionBps : null,
      ];
      let id: string;
      if (open.rows[0]) {
        if (open.rows[0].status === 'SUBMITTED') throw new ConflictException({ code: 'application_pending', message: 'your application is already being reviewed' });
        id = open.rows[0].id;
        // a document staff flagged has to be replaced, not sent again as it was
        const flagged: string[] = (await client.query(`SELECT change_items FROM driver_applications WHERE id = $1`, [id])).rows[0]?.change_items ?? [];
        if (flagged.length) {
          const before = (await client.query(`SELECT kind, file_id FROM application_documents WHERE application_id = $1`, [id])).rows;
          for (const kind of flagged) {
            const was = before.find((d) => d.kind === kind);
            const now = input.documents.find((d) => d.kind === kind);
            if (was && now && was.file_id === now.fileId) throw new BadRequestException(`${kind.replace(/_/g, ' ')} needs a new photo: staff asked for it to be replaced`);
          }
        }
        await client.query(
          `UPDATE driver_applications SET status = 'SUBMITTED', change_items = '{}', vehicle_category = $2, vehicle_make = $3, vehicle_colour = $4, vehicle_plate = $5, arrangement = $6,
                  owner_name = $7, owner_phone = $8, email = $9, contact_preference = $10, date_of_birth = $11, nin = $12, lassdri_number = $13, address = $14,
                  next_of_kin_name = $15, next_of_kin_phone = $16, next_of_kin_relationship = $17, next_of_kin_address = $18, nin_status = $19, nin_reason = $20, nin_reference = $21, deduction_bps = $22, nin_checked_at = now(), submitted_at = now(), updated_at = now()
            WHERE id = $1`,
          [id, ...cols],
        );
        await client.query(`DELETE FROM application_documents WHERE application_id = $1`, [id]);
      } else {
        const created = await client.query(
          `INSERT INTO driver_applications (driver_id, vehicle_category, vehicle_make, vehicle_colour, vehicle_plate, arrangement, owner_name, owner_phone,
                  email, contact_preference, date_of_birth, nin, lassdri_number, address, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship, next_of_kin_address,
                  nin_status, nin_reason, nin_reference, deduction_bps, nin_checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, now()) RETURNING id`,
          [driverId, ...cols],
        );
        id = created.rows[0].id;
      }
      for (const d of input.documents) {
        await client.query(
          `INSERT INTO application_documents (application_id, kind, file_ref, number, file_id, expires_on) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, d.kind, `file:${d.fileId}`, d.number?.trim() || null, d.fileId, d.expiresOn ?? null],
        );
      }
      await client.query('COMMIT');
      return { id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private readonly lookups = new Map<string, number[]>();

  /** Is this number free for this driver? Limited, so the list of registered numbers cannot be read out one guess at a time. */
  async identifierAvailable(driverId: string, kind: IdentifierKind, value: string): Promise<boolean> {
    const now = Date.now();
    const hits = (this.lookups.get(driverId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 30) throw new HttpException('too many checks, wait a moment', HttpStatus.TOO_MANY_REQUESTS);
    hits.push(now);
    this.lookups.set(driverId, hits);
    return identifierAvailable(this.pool, driverId, kind, value);
  }

  /** The driver's most recent application, everything they entered, and what staff said about it. */
  async mine(driverId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_applications WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`, [driverId]);
    if (!rows[0]) return null;
    const docs = await this.pool.query(`SELECT kind, number, file_id, expires_on FROM application_documents WHERE application_id = $1`, [rows[0].id]);
    return {
      ...this.presentSummary(rows[0]),
      documents: docs.rows.map((d) => ({ kind: d.kind, number: d.number, fileId: d.file_id, expiresOn: d.expires_on })),
    };
  }

  // ------------------------------------------------------------------ staff side

  private presentSummary(r: any) {
    return {
      id: r.id,
      driverId: r.driver_id,
      status: r.status,
      arrangement: r.arrangement,
      owner: r.owner_name ? { name: r.owner_name, phone: r.owner_phone } : null,
      deductionBps: r.deduction_bps,
      vehicle: { category: r.vehicle_category, make: r.vehicle_make, colour: r.vehicle_colour, plate: r.vehicle_plate },
      approvedCategory: r.approved_category,
      ninCheck: { status: r.nin_status, reason: r.nin_reason },
      personal: {
        email: r.email, contactPreference: r.contact_preference, dateOfBirth: r.date_of_birth, nin: r.nin, lassdri: r.lassdri_number, address: r.address,
        nextOfKin: { name: r.next_of_kin_name, phone: r.next_of_kin_phone, relationship: r.next_of_kin_relationship, address: r.next_of_kin_address },
      },
      reviewNote: r.review_note,
      changeItems: (r.change_items ?? []) as string[],
      submittedAt: r.submitted_at,
      reviewedAt: r.reviewed_at,
    };
  }

  async queue(status = 'SUBMITTED') {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.full_name, u.phone FROM driver_applications a JOIN users u ON u.id = a.driver_id
        WHERE a.status = $1 ORDER BY a.submitted_at LIMIT 200`,
      [status],
    );
    return rows.map((r) => ({ ...this.presentSummary(r), driverName: r.full_name, phone: r.phone }));
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.full_name, u.phone, u.status AS user_status FROM driver_applications a JOIN users u ON u.id = a.driver_id WHERE a.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('application not found');
    const docs = await this.pool.query(
      `SELECT kind, file_ref, number, file_id, expires_on, expires_on < current_date AS expired FROM application_documents WHERE application_id = $1 ORDER BY kind`,
      [id],
    );
    return {
      ...this.presentSummary(rows[0]),
      driverName: rows[0].full_name,
      phone: rows[0].phone,
      accountStatus: rows[0].user_status,
      documents: docs.rows.map((d) => ({ kind: d.kind, fileRef: d.file_ref, number: d.number, fileId: d.file_id, expiresOn: d.expires_on, expired: d.expired })),
      missingDocuments: requiredDocuments(rows[0].arrangement).filter((k) => !docs.rows.some((d) => d.kind === k)),
    };
  }

  /**
   * Approve: every required document must be present and unexpired, and the reviewer confirms the vehicle category after
   * inspecting it (the driver's request is the default). This is what creates the driver's vehicle, so a driver cannot
   * reach dispatch without passing review. A plate already on another active vehicle blocks approval.
   * For a platform vehicle the approver also says which car the driver gets and the payment plan, and both are created
   * in the same step, so a driver is never approved onto a car with no agreement behind it.
   */
  async approve(id: string, staffId: string, opts: { assignment?: Assignment; category?: string; fleet?: { fleetVehicleId: string; deductionBps: number; targetKobo?: number | null } } = {}): Promise<void> {
    const { assignment } = opts;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const app = (await client.query(`SELECT * FROM driver_applications WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!app) throw new NotFoundException('application not found');
      if (app.status !== 'SUBMITTED') throw new ConflictException({ code: 'wrong_state', message: `application is ${app.status}` });

      const docs = (
        await client.query(`SELECT kind, expires_on < current_date AS expired FROM application_documents WHERE application_id = $1`, [id])
      ).rows;
      const problems = [
        ...requiredDocuments(app.arrangement).filter((k) => !docs.some((d) => d.kind === k)).map((k) => `${k} is missing`),
        ...docs.filter((d) => d.expired).map((d) => `${d.kind} has expired`),
      ];
      if (problems.length) throw new ConflictException({ code: 'documents_not_ready', message: problems.join('; ') });

      // The NIN must have passed. A check still pending (or never run, for older applications) is asked again now.
      if (app.nin_status !== 'verified') {
        const owner = (await client.query(`SELECT full_name FROM users WHERE id = $1`, [app.driver_id])).rows[0]?.full_name ?? '';
        const again = await this.nin.check({ nin: app.nin, fullName: owner, dateOfBirth: app.date_of_birth });
        await client.query(`UPDATE driver_applications SET nin_status = $2, nin_reason = $3, nin_reference = COALESCE($4, nin_reference), nin_checked_at = now() WHERE id = $1`, [id, again.status, again.reason ?? null, again.reference ?? null]);
        if (again.status !== 'verified') {
          await client.query('COMMIT');
          throw new ConflictException({ code: 'nin_not_verified', message: again.status === 'pending' ? 'The NIN check has not finished. Try again in a minute, or accept it by hand.' : (again.reason ?? 'The NIN could not be verified.') });
        }
      }
      const arr = (await client.query(`SELECT needs_plan FROM vehicle_arrangements WHERE code = $1`, [app.arrangement])).rows[0];
      if (arr.needs_plan && !assignment) throw new BadRequestException('choose the vehicle to give this driver and set up the payment plan');
      // the car: what the driver declared, what staff assign for a legacy platform vehicle, or (for a business vehicle) none yet:
      // the business gives one later from its list, or the approver picks one now
      const business = app.arrangement === 'business_vehicle';
      const car = arr.needs_plan
        ? { make: assignment!.vehicle.make.trim(), colour: assignment!.vehicle.colour.trim(), plate: normalisePlate(assignment!.vehicle.plate) }
        : { make: app.vehicle_make, colour: app.vehicle_colour, plate: app.vehicle_plate };
      let category: string = (arr.needs_plan ? assignment!.vehicle.category : opts.category) ?? app.vehicle_category;
      if (business && opts.fleet) {
        const fv = (await client.query(`SELECT category FROM fleet_vehicles WHERE id = $1`, [opts.fleet.fleetVehicleId])).rows[0];
        if (!fv) throw new NotFoundException('vehicle not found');
        category = fv.category; // the category of the vehicle the driver is given
      }
      if (!business) car.plate = parsePlate(car.plate);

      const cat = await client.query(`SELECT active FROM asset_types WHERE code = $1`, [category]);
      if (!cat.rows[0]?.active) throw new ConflictException({ code: 'category_off', message: 'that vehicle category is switched off' });
      // approve first (the database refuses unless the category is confirmed), then create the vehicle from it
      await client.query(
        `UPDATE driver_applications SET status = 'APPROVED', approved_category = $2, category_confirmed_by = $3, category_confirmed_at = now(),
                reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1`,
        [id, category, staffId],
      );
      // the photo they sent becomes their profile picture, seen by riders, staff and the business
      await client.query(
        `UPDATE users SET avatar_file_id = d.file_id FROM application_documents d WHERE d.application_id = $1 AND d.kind = 'selfie' AND d.file_id IS NOT NULL AND users.id = $2`,
        [id, app.driver_id],
      );
      if (business) {
        if (opts.fleet) await this.fleet.assignInTx(client, opts.fleet.fleetVehicleId, app.driver_id, { deductionBps: opts.fleet.deductionBps, targetKobo: opts.fleet.targetKobo ?? null, setBy: 'owner' }, staffId);
      } else {
        await client.query(`UPDATE vehicles SET active = false WHERE driver_id = $1 AND active`, [app.driver_id]);
        await client.query(`UPDATE vehicle_assignments SET ended_at = now(), ended_reason = 'replaced by a new vehicle' WHERE driver_id = $1 AND ended_at IS NULL`, [app.driver_id]);
        let vehicleId: string;
        try {
          vehicleId = (await client.query(
            `INSERT INTO vehicles (driver_id, category, make, colour, plate, arrangement, owner_name, owner_phone, application_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [app.driver_id, category, car.make, car.colour, car.plate, app.arrangement, app.owner_name, app.owner_phone, id],
          )).rows[0].id;
        } catch (e: any) {
          if (e?.code === '23505') throw new ConflictException({ code: 'plate_in_use', message: 'that number plate is registered to another driver' });
          throw e;
        }
        // who drives what: always recorded. A borrowed car also has an owner, who is paid the share the driver chose.
        let ownerId: string | null = null;
        if (app.arrangement === 'third_party') {
          ownerId = (await client.query(`INSERT INTO vehicle_owners (kind, name, phone) VALUES ('individual', $1, $2) RETURNING id`, [app.owner_name, app.owner_phone])).rows[0].id;
        }
        await client.query(
          `INSERT INTO vehicle_assignments (driver_id, vehicle_id, owner_id, deduction_bps, deduction_set_by, assigned_by, agreement_accepted_at) VALUES ($1, $2, $3, $4, 'driver', $5, CASE WHEN $3::uuid IS NULL THEN now() END)`,
          [app.driver_id, vehicleId, ownerId, ownerId ? (app.deduction_bps ?? 0) : 0, staffId],
        );
        if (arr.needs_plan) await this.plans.createInTx(client, app.driver_id, vehicleId, assignment!.plan, staffId);
      }
      await client.query('COMMIT');
      await this.redis.del(`driver:${app.driver_id}:category`); // pick up the new vehicle on the next ping
      void this.push?.toUser(app.driver_id, { type: 'application', title: 'Congratulations! You are approved', body: 'Open 9jaRide Pro to continue to the next step.' }, 'driver');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** An admin accepts a NIN by hand, for example when the provider cannot find a real person. The reason is kept. */
  async acceptNinByHand(id: string, staffId: string, note: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE driver_applications SET nin_status = 'verified', nin_reason = $2, nin_checked_at = now() WHERE id = $1 AND status = 'SUBMITTED'`,
      [id, `Accepted by hand (${staffId}): ${note}`],
    );
    if (!res.rowCount) throw new ConflictException({ code: 'wrong_state', message: 'only an application waiting for review can be changed' });
  }

  private async decide(id: string, staffId: string, status: 'REJECTED' | 'CHANGES_REQUESTED', note: string, items: string[] = []) {
    const res = await this.pool.query(
      `UPDATE driver_applications SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now(), change_items = $5
        WHERE id = $1 AND status = 'SUBMITTED'`,
      [id, status, note, staffId, items],
    );
    if (res.rowCount) {
      const who = (await this.pool.query(`SELECT driver_id FROM driver_applications WHERE id = $1`, [id])).rows[0]?.driver_id;
      if (who) void this.push?.toUser(who, status === 'REJECTED'
        ? { type: 'application', title: 'Application not approved', body: 'Open 9jaRide Pro to see why.' }
        : { type: 'application', title: 'Your application needs an update', body: 'Open 9jaRide Pro to see what to change. Everything else is saved.' }, 'driver');
      return;
    }
    const { rows } = await this.pool.query(`SELECT status FROM driver_applications WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('application not found');
    throw new ConflictException({ code: 'wrong_state', message: `application is ${rows[0].status}` });
  }

  reject(id: string, staffId: string, reason: string) {
    return this.decide(id, staffId, 'REJECTED', reason);
  }

  requestChanges(id: string, staffId: string, note: string, items: string[] = []) {
    const bad = items.filter((i) => !CHANGE_ITEMS.includes(i));
    if (bad.length) throw new BadRequestException(`unknown item to change: ${bad.join(', ')}`);
    return this.decide(id, staffId, 'CHANGES_REQUESTED', note, [...new Set(items)]);
  }

  // ------------------------------------------------------------------ account status

  /** Stop an account at once: no new sign-ins, sessions revoked, and a driver leaves the map. */
  async setAccountStatus(userId: string, staffId: string, status: 'active' | 'suspended', reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`UPDATE users SET status = $2 WHERE id = $1 AND status <> $2 RETURNING role`, [userId, status]);
      if (!res.rowCount) {
        await client.query('ROLLBACK');
        const exists = await this.pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
        if (!exists.rowCount) throw new NotFoundException('user not found');
        return false; // already in that state
      }
      await client.query(`INSERT INTO user_status_events (user_id, status, reason, actor_id) VALUES ($1, $2, $3, $4)`, [userId, status, reason, staffId]);
      await client.query('COMMIT');
      if (status === 'active') await this.redis.del(suspendedKey(userId));
      if (status === 'suspended') {
        await this.redis.set(suspendedKey(userId), '1', 'EX', ACCESS_TOKEN_SECONDS + 60);
        await this.tokens.revokeAll('user', userId);
        await this.redis.del(`driver:${userId}:category`, keys.driverState(userId));
        await this.redis.zrem(keys.geo('regular'), userId);
        await this.redis.zrem(keys.geo('comfort'), userId);
        await this.redis.zrem(keys.geo('package'), userId);
      }
      return true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
