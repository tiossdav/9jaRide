import ExcelJS from 'exceljs';
import { PLATE_MESSAGE, isValidPlate, normalisePlate } from '../common/plate';

/** One line of a vehicle list, checked and ready to save. */
export interface VehicleRow {
  row: number; // the line number in the file, counting the header as line 1
  plate: string;
  makeModel: string;
  colour: string;
  category: string; // an asset type code
  year: number | null;
  vin: string | null;
  notes: string | null;
}

/** Why a line was not imported, in words the person who made the file can act on. */
export interface RowError { row: number; plate: string | null; message: string }

export const MAX_ROWS = 1000;
export const TEMPLATE_HEADER = ['plate', 'make_model', 'colour', 'category', 'year', 'vin', 'notes'];

// the names people give their columns, mapped to ours
const ALIASES: Record<string, string> = {
  plate: 'plate', platenumber: 'plate', platenumbers: 'plate', registration: 'plate', registrationnumber: 'plate', regno: 'plate', reg: 'plate',
  makemodel: 'make_model', model: 'make_model', make: 'make_model', makeandmodel: 'make_model', vehicle: 'make_model', vehiclemodel: 'make_model', car: 'make_model',
  colour: 'colour', color: 'colour',
  category: 'category', type: 'category', class: 'category', vehicletype: 'category',
  year: 'year', modelyear: 'year', yearofmanufacture: 'year',
  vin: 'vin', chassis: 'vin', chassisnumber: 'vin', vinchassis: 'vin',
  notes: 'notes', note: 'notes', remarks: 'notes', comment: 'notes', comments: 'notes',
};
const keyOf = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Splits comma, semicolon or tab separated text, with quoted cells and quotes inside quotes. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const first = body.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let cell = ''; let row: string[] = []; let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && body[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The first sheet of an Excel file, as rows of text. */
export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = r.getCell(c).value;
      cells.push(v == null ? '' : typeof v === 'object' ? ('text' in v ? String((v as { text: unknown }).text) : 'result' in v ? String((v as { result: unknown }).result ?? '') : String(v)) : String(v));
    }
    rows.push(cells);
  });
  return rows;
}

export type FileKind = 'csv' | 'xlsx';
export function fileKind(buffer: Buffer, filename: string): FileKind | null {
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx'; // an xlsx is a zip
  if (/\.(csv|txt|tsv)$/i.test(filename) && !buffer.subarray(0, 512).includes(0)) return 'csv';
  return null;
}

/**
 * Checks a table of rows: the header must have the columns we need, each line must be complete and sensible, and no
 * plate may appear twice in the file or already be in the system. Good lines come back ready to save; bad ones come
 * back with a reason. [known] is the set of plates already registered; [categories] maps what people write to a code.
 */
export function validateTable(table: string[][], categories: Map<string, string>, known: Set<string>): { rows: VehicleRow[]; errors: RowError[]; headerProblem?: string } {
  if (table.length === 0) return { rows: [], errors: [], headerProblem: 'The file is empty.' };
  const header = table[0].map((h) => ALIASES[keyOf(h)] ?? null);
  const need = ['plate', 'make_model', 'colour', 'category'];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) return { rows: [], errors: [], headerProblem: `The first line must name these columns: ${missing.join(', ')}. Expected columns: ${TEMPLATE_HEADER.join(', ')}.` };
  const at = (name: string) => header.indexOf(name);
  const thisYear = new Date().getFullYear();

  const rows: VehicleRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  const body = table.slice(1).map((cells, i) => ({ cells, line: i + 2 })).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (body.length > MAX_ROWS) return { rows: [], errors: [], headerProblem: `A file can hold up to ${MAX_ROWS} vehicles; this one has ${body.length}. Split it and import in parts.` };

  for (const { cells, line } of body) {
    const get = (name: string) => (at(name) >= 0 ? (cells[at(name)] ?? '').trim() : '');
    const plate = normalisePlate(get('plate'));
    const fail = (message: string) => errors.push({ row: line, plate: plate || null, message });
    if (!isValidPlate(plate)) { fail(PLATE_MESSAGE); continue; }
    if (get('make_model').length < 2) { fail('The make and model are missing.'); continue; }
    if (get('colour').length < 2) { fail('The colour is missing.'); continue; }
    const category = categories.get(get('category').toLowerCase());
    if (!category) { fail(`"${get('category')}" is not a category we have. Use: ${[...new Set(categories.values())].join(', ')}.`); continue; }
    let year: number | null = null;
    if (get('year')) {
      year = Number(get('year'));
      if (!Number.isInteger(year) || year < 1990 || year > thisYear + 1) { fail(`The year "${get('year')}" is not valid.`); continue; }
    }
    if (seen.has(plate)) { fail(`The same plate is already on line ${seen.get(plate)}.`); continue; }
    if (known.has(plate)) { fail('This plate is already registered.'); continue; }
    seen.set(plate, line);
    rows.push({ row: line, plate, makeModel: get('make_model'), colour: get('colour'), category, year, vin: get('vin') || null, notes: get('notes') || null });
  }
  return { rows, errors };
}

/** A blank file with the right columns and one example, for people to fill in. */
export const TEMPLATE_CSV = `${TEMPLATE_HEADER.join(',')}\nKJA482AB,Toyota Corolla,Silver,regular,2019,,Example line: delete me\n`;
