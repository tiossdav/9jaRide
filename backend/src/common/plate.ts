import { BadRequestException } from '@nestjs/common';

/** A Nigerian plate: three letters, a hyphen, three digits, two letters (ABC-123XY). Stored without the hyphen. */
export const PLATE_PATTERN = /^[A-Z]{3}[0-9]{3}[A-Z]{2}$/;
export const PLATE_MESSAGE = 'The plate number must look like ABC-123XY: three letters, three digits, then two letters.';
export const isValidPlate = (normalised: string): boolean => PLATE_PATTERN.test(normalised);

/** How a number plate is stored everywhere: capital letters and digits only. "kja 482-ab" is stored as KJA482AB. */
export const normalisePlate = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Capitalise, drop spaces and the hyphen, then insist on the format. Returns the stored form (ABC123XY) or refuses with a message for the field. */
export function parsePlate(input: string): string {
  const plate = normalisePlate(input ?? '');
  if (!isValidPlate(plate)) throw new BadRequestException({ code: 'bad_plate', field: 'plate', message: PLATE_MESSAGE });
  return plate;
}

/** How a plate is shown in reports and exports: the standard dash after the first three characters (KJA-482AB). */
export const displayPlate = (stored: string | null | undefined): string => {
  const p = normalisePlate(stored ?? '');
  return p.length <= 3 ? p : `${p.slice(0, 3)}-${p.slice(3)}`;
};

/** A SQL LIKE pattern that finds a plate however the person typed it, or '' when the search is too short to be a plate. */
export const plateLike = (search: string): string => {
  const p = normalisePlate(search);
  return p.length >= 2 ? `%${p}%` : '';
};
