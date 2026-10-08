import { BadRequestException, ConflictException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

/** What makes a driver one person: the NIN, the LASDRI number and the driver's licence number can each belong to one driver only. */
export type IdentifierKind = 'nin' | 'lassdri' | 'drivers_licence';

const LABEL: Record<IdentifierKind, string> = { nin: 'NIN', lassdri: 'LASDRI number', drivers_licence: "driver's licence number" };
const FIELD: Record<IdentifierKind, string> = { nin: 'nin', lassdri: 'lassdri', drivers_licence: 'licenceNumber' };

/**
 * How an identifier is compared. People type the same number in different ways ("abc 123-45", "ABC12345"), so spaces, hyphens and
 * slashes are removed and letters are capitalised before anything is checked or stored. A NIN is digits only.
 */
export function normaliseIdentifier(kind: IdentifierKind, raw: string): string {
  const s = String(raw ?? '');
  return kind === 'nin' ? s.replace(/\D/g, '') : s.toUpperCase().replace(/[\s\-/.]/g, '');
}

/** The same message for every identifier, naming only the kind and never who holds it. */
export const duplicateMessage = (kind: IdentifierKind) => `This ${LABEL[kind]} is already registered.`;

export const duplicateError = (kind: IdentifierKind) =>
  new ConflictException({ code: 'duplicate_identifier', field: FIELD[kind], message: duplicateMessage(kind) });

/**
 * Take these identifiers for a driver. A driver keeps what they already hold; a value another driver holds is refused. The database's
 * primary key on (kind, value) settles two drivers claiming the same number at the same moment: only one insert wins.
 * Call inside the transaction that saves the application, so a refusal leaves nothing half done.
 */
export async function claimIdentifiers(client: Pick<PoolClient, 'query'>, driverId: string, wanted: Partial<Record<IdentifierKind, string>>): Promise<void> {
  for (const kind of Object.keys(wanted) as IdentifierKind[]) {
    const value = normaliseIdentifier(kind, wanted[kind] ?? '');
    if (!value) continue;
    // the driver is changing their number: let go of the old one first
    await client.query(`DELETE FROM driver_identifiers WHERE kind = $1 AND driver_id = $2 AND value <> $3`, [kind, driverId, value]);
    const taken = await client.query(
      `INSERT INTO driver_identifiers (kind, value, driver_id) VALUES ($1, $2, $3) ON CONFLICT (kind, value) DO NOTHING RETURNING driver_id`, [kind, value, driverId]);
    if (taken.rowCount) continue;
    const owner = await client.query(`SELECT driver_id FROM driver_identifiers WHERE kind = $1 AND value = $2`, [kind, value]);
    if (owner.rows[0] && owner.rows[0].driver_id !== driverId) throw duplicateError(kind);
  }
}

/** Is this identifier free for this driver? Answers only yes or no. */
export async function identifierAvailable(db: Pick<Pool, 'query'>, driverId: string, kind: IdentifierKind, raw: string): Promise<boolean> {
  const value = normaliseIdentifier(kind, raw);
  if (!value) throw new BadRequestException('enter the number first');
  const { rows } = await db.query(`SELECT driver_id FROM driver_identifiers WHERE kind = $1 AND value = $2`, [kind, value]);
  return !rows[0] || rows[0].driver_id === driverId;
}
