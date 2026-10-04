import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { Principal } from '../auth/auth.types';
import { PG_POOL } from '../common/infra.module';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Where the bytes go. A folder today; a cloud bucket later means writing one more class with these two methods. */
export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Keeps files in the database. Chosen with FILE_STORAGE=db, for hosts where a local folder would not survive a restart. */
@Injectable()
export class DbFileStorage implements FileStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async put(key: string, bytes: Buffer) {
    await this.pool.query(`INSERT INTO file_blobs (storage_key, bytes) VALUES ($1, $2)`, [key, bytes]);
  }
  async get(key: string) {
    const { rows } = await this.pool.query(`SELECT bytes FROM file_blobs WHERE storage_key = $1`, [key]);
    if (!rows[0]) throw new NotFoundException('file not found');
    return rows[0].bytes as Buffer;
  }
}

export class LocalFileStorage implements FileStorage {
  private readonly dir = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));
  async put(key: string, bytes: Buffer) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), bytes, { flag: 'wx' });
  }
  get(key: string) {
    return readFile(join(this.dir, key));
  }
}

/** What the file really is, from its first bytes, not from the name or the type the sender claims. */
export function sniffType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

@Injectable()
export class FilesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async save(ownerId: string, bytes: Buffer | undefined): Promise<{ id: string; mimeType: string; sizeBytes: number }> {
    if (!bytes?.length) throw new BadRequestException('no file was sent');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('that file is too big (8 MB at most)');
    const mimeType = sniffType(bytes);
    if (!mimeType) throw new BadRequestException('send a photo (JPEG, PNG or WebP) or a PDF');
    const key = randomUUID();
    await this.storage.put(key, bytes);
    const { rows } = await this.pool.query(`INSERT INTO uploaded_files (owner_id, mime_type, size_bytes, storage_key) VALUES ($1, $2, $3, $4) RETURNING id`, [ownerId, mimeType, bytes.length, key]);
    return { id: rows[0].id, mimeType, sizeBytes: bytes.length };
  }

  /** The owner may read their own files; support and admin staff may read anyone's, to review applications. */
  async read(id: string, who: Principal): Promise<{ bytes: Buffer; mimeType: string }> {
    const { rows } = await this.pool.query(`SELECT owner_id, mime_type, storage_key FROM uploaded_files WHERE id = $1`, [id]);
    const f = rows[0];
    if (!f) throw new NotFoundException('file not found');
    const staff = who.kind === 'staff' && (who.role === 'support' || who.role === 'admin');
    if (!staff && f.owner_id !== who.id) throw new ForbiddenException('this file is not yours');
    return { bytes: await this.storage.get(f.storage_key), mimeType: f.mime_type };
  }

  /** True when every id exists and belongs to this person. */
  async ownedBy(ownerId: string, ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM uploaded_files WHERE owner_id = $1 AND id = ANY($2::uuid[])`, [ownerId, ids]);
    return rows[0].n === new Set(ids).size;
  }
}
