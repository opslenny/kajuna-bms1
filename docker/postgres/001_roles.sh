#!/bin/sh
set -eu

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
CREATE ROLE kajuna_app LOGIN PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO kajuna_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kajuna_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kajuna_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kajuna_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kajuna_app;
SQL
