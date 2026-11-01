# Supabase, Vercel, and Namecheap deployment

This project can keep its existing React frontend and Express API while using
Supabase for PostgreSQL and private image storage, and Vercel for the frontend
and API. The Vercel API uses the same `/api` origin as the frontend, so the
existing HttpOnly session cookie continues to work.

You will need accounts and a project in each provider. Creating the accounts,
buying the domain, and entering provider credentials must be done by you; never
put a database password or Supabase secret/service-role key in the repository or
a `VITE_*` variable.

## 1. Create Supabase resources

1. Create a Supabase project in a region close to your users. Save its database
   password and project URL.
2. In **Storage**, create a bucket named `bms-images` and keep it **private**.
   The API serves images only after authenticating the application user.
3. Keep a project **secret key** private. Vercel needs it to upload, download,
   and delete objects in the private bucket. The legacy `service_role` key is
   also supported if the project has not created a secret key yet.
4. Keep separate database connection strings for the application and database
   administration:
   - Vercel runtime: the **Shared Pooler, Transaction** connection string.
   - Schema migrations and `pg_dump`/`pg_restore`: the **Direct** connection
     string. If your local network cannot use IPv6, use the Supabase session
     pooler for these administrative tasks.

Copy connection strings from the Supabase **Connect** dialog rather than
constructing them. Replace the password and URL-encode special characters in
it. Do not use the transaction pooler for migrations or native backup/restore
commands.

## 2. Preserve and migrate the current database

Do this before changing production traffic. Keep the old database and image
directory unchanged until the new deployment has been tested. Pause writes
during the final export/import so no changes are missed.

1. Back up the current database and verify that the source application is on
   the latest project migrations:

   ```powershell
   $env:MIGRATION_DATABASE_URL = "your-current-database-migration-connection-string"
   npm run db:migrate
   ```

2. Create a custom-format, data-only backup. Use the source database's
   full-privilege migration/owner connection string (`MIGRATION_DATABASE_URL`),
   not the restricted application role; otherwise row-level security could
   omit tenant data:

   ```powershell
   $env:SOURCE_DATABASE_URL = "your-current-database-migration-connection-string"
   pg_dump --data-only --no-owner --no-acl --format=custom `
     --exclude-table-data=public.schema_migrations `
     --file=.\kajuna-bms-data.dump "$env:SOURCE_DATABASE_URL"
   ```

3. Point `MIGRATION_DATABASE_URL` at the new Supabase **Direct** connection and
   create the schema at the current migration version:

   ```powershell
   $env:MIGRATION_DATABASE_URL = "your-supabase-direct-connection-string"
   npm run db:migrate
   ```

4. The migrations create one default subscription plan. Since this is a
   **brand-new, empty Supabase project**, remove that seed row before importing
   the source rows. Run this once in the Supabase SQL Editor:

   ```sql
   DELETE FROM public.subscription_plans;
   ```

   Do not run that statement on a database with customer data.

5. Restore the data-only backup into the same Supabase project:

   ```powershell
   pg_restore --data-only --no-owner --no-acl `
     --dbname "$env:MIGRATION_DATABASE_URL" .\kajuna-bms-data.dump
   ```

   This preserves IDs and relationships across businesses, users, sales,
   products, subscriptions, audit records, and other existing tables. Compare
   key table counts with the source before proceeding.

6. Upload existing filesystem-backed logos, profile images, and any remaining
   file-backed product images while the original `data/images` directory is
   still available. Run this from the machine that has that directory:

   ```powershell
   $env:SUPABASE_URL = "https://your-project.supabase.co"
   $env:SUPABASE_SECRET_KEY = "your-private-secret-key"
   $env:SUPABASE_STORAGE_BUCKET = "bms-images"
   npm run storage:migrate:supabase
   ```

   The script keeps each existing object key unchanged, so database references
   continue to work. It uploads all supported PNG, JPEG, and WebP files from
   `IMAGE_STORAGE_DIR` (default: `data/images`). It fails on upload errors;
   correct the issue and rerun it before cutover. The operation is safe to
   rerun.

The source and target schema versions must match. Do not restore into a
Supabase project containing tables or data you need to keep.

## 3. Create a restricted runtime database role

Do not connect the deployed API as `postgres` or the database owner. Generate a
strong password and run the following in the Supabase SQL Editor, replacing the
password with a unique value:

```sql
CREATE ROLE kajuna_app LOGIN NOBYPASSRLS PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT USAGE ON SCHEMA public TO kajuna_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kajuna_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kajuna_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kajuna_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kajuna_app;
```

In the Supabase **Shared Pooler, Transaction** connection string, use the
`kajuna_app` role and the project-reference username format shown in the
Supabase connection dialog. Set this restricted connection as Vercel's
`DATABASE_URL`. Because the application depends on transaction-local
`app.business_id` and `app.is_platform_admin` settings, use transaction pooling,
not session pooling, for the Vercel runtime.

## 4. Deploy the project to Vercel

Import this Git repository as a Vercel project. Keep the repository root as the
project root; [`vercel.json`](./vercel.json) builds the Vite frontend to `dist`
and the catch-all Node function in `api/` serves the Express API.

Set these Vercel **Production** environment variables before deploying:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URL for `kajuna_app` |
| `DATABASE_POOL_SIZE` | `1` |
| `APP_ORIGIN` | Exact public origin, e.g. `https://yourdomain.com` |
| `SETUP_TOKEN` | New, high-entropy setup token |
| `IMAGE_STORAGE_PROVIDER` | `supabase` |
| `SUPABASE_URL` | Project URL, e.g. `https://your-project.supabase.co` |
| `SUPABASE_SECRET_KEY` | Private Supabase secret key |
| `SUPABASE_STORAGE_BUCKET` | `bms-images` |
| `MAX_IMAGE_BYTES` | `4000000` |
| `MAX_PRODUCT_IMAGE_BYTES` | `4000000` |

Set `APP_ORIGINS` instead of `APP_ORIGIN` if the production site uses more than
one exact origin (for example, both apex and `www`). Wildcards are not accepted.
Vercel's current deployment URL is also allowed for preview deployments. Add
`GOOGLE_CLIENT_ID` if Google sign-in is enabled, and update the authorized
JavaScript origins in Google Cloud to match your production domain.

The lower image-size limits keep requests below Vercel Function's request-body
limit; local deployments retain the existing 5 MiB default. Add
secrets in Vercel's project settings, not in source files or commit history.
Set the variables for Preview and Development only if those environments have
their own suitable Supabase resources and allowed origins.

The API's Express rate limits use in-memory counters, which are per serverless
instance on Vercel. For production-wide abuse protection, also configure Vercel
Firewall rate limits or a shared rate-limit store; do not treat per-instance
counters as a global limit.

Deploy, then confirm `https://yourdomain.com/api/health` responds successfully.
Test sign-in, a protected page, a logo/profile image upload, and image removal
before switching all users to the new site. Check Vercel function logs and
Supabase logs if a request fails.

## 5. Buy and connect a Namecheap domain

1. Search for and register the domain in Namecheap. Confirm the spelling,
   renewal settings, and account contact details before paying.
2. In Vercel, open the project **Settings → Domains**, add the domain, and
   follow the exact DNS records Vercel displays. Vercel may ask for an apex
   `A` record and a `www` `CNAME`; use the values shown for your project.
3. In Namecheap **Domain List → Manage → Advanced DNS**, add or update those
   records. Remove conflicting records for the same host, but leave unrelated
   email records (MX, SPF, DKIM, and DMARC) in place.
4. Wait for DNS propagation and for Vercel to issue the HTTPS certificate.
   Choose one canonical host (apex or `www`) in Vercel and redirect the other.
5. Set `APP_ORIGIN`/`APP_ORIGINS` to the canonical `https://` origin, redeploy,
   and add the domain to Google OAuth authorized origins if applicable.

You can keep Namecheap as the DNS provider; changing nameservers to Vercel is
optional and would move DNS management away from Namecheap.

## Rollback and cleanup

Keep the old application, database backup, and image directory until the new
deployment has been exercised in production. If cutover fails, point the domain
back to the old deployment and restore its original database connection. Do not
delete the source data or backup until you have a verified restore and a
separate backup of the Supabase project.
