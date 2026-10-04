-- A profile photo for any account: the file is one the person uploaded (see uploaded_files).
ALTER TABLE users ADD COLUMN avatar_file_id uuid REFERENCES uploaded_files(id);
