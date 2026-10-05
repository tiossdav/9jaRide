/** How a number plate is stored everywhere: capital letters and digits only. "kja 482-ab" is stored as KJA482AB. */
export const normalisePlate = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

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
