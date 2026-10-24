-- Connection bookkeeping only; business tables and initial admin are in setup.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS taskforce_app.upload_grants (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES taskforce_app.users(id) ON DELETE CASCADE,
  target TEXT NOT NULL, stored TEXT NOT NULL, filename TEXT NOT NULL,
  size BIGINT NOT NULL, mime TEXT NOT NULL, expires_at BIGINT NOT NULL
);
ALTER TABLE taskforce_app.upload_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON taskforce_app.upload_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON taskforce_app.upload_grants TO service_role;
COMMIT;
