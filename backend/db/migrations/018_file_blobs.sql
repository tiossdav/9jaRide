-- Where uploaded files are kept when FILE_STORAGE=db: inside the database itself. It suits a small hosted test, where a
-- disk would be an extra cost; a cloud bucket replaces it later without touching the rest of the app.
CREATE TABLE file_blobs (
  storage_key text PRIMARY KEY,
  bytes       bytea NOT NULL
);
CREATE TRIGGER file_blobs_append_only BEFORE UPDATE OR DELETE ON file_blobs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
