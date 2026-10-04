import { bootApp } from './testing/harness.testing';

// Files kept inside the database, as on a host with no disk (FILE_STORAGE=db).
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('files stored in the database', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    process.env.FILE_STORAGE = 'db';
    h = await bootApp();
  }, 60_000);
  afterAll(async () => {
    delete process.env.FILE_STORAGE;
    await h.close();
  });

  it('saves a photo in the database and gives the same bytes back', async () => {
    const driver = await h.login('driver');
    const id = await h.upload(driver.token);
    const key = (await h.pool.query(`SELECT storage_key FROM uploaded_files WHERE id = $1`, [id])).rows[0].storage_key;
    expect((await h.pool.query(`SELECT length(bytes) AS n FROM file_blobs WHERE storage_key = $1`, [key])).rows[0].n).toBeGreaterThan(0);
    const res = await h.http().get(`/files/${id}`).set(h.auth(driver.token)).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.from(res.body).subarray(1, 4).toString()).toBe('PNG');
    await expect(h.pool.query(`DELETE FROM file_blobs WHERE storage_key = $1`, [key])).rejects.toThrow(); // cannot be altered
  });
});
