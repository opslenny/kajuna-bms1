ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
  ON users (google_sub) WHERE google_sub IS NOT NULL;

ALTER TABLE business_registration_requests ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS business_registration_google_sub_unique
  ON business_registration_requests (google_sub) WHERE google_sub IS NOT NULL;
