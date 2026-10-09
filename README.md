# KAJUNA BMS

KAJUNA BMS is a React/Vite business management application. The PostgreSQL schema and migration tooling are in `server/db`.

## PostgreSQL setup

1. Install Docker Desktop, then copy `.env.example` to `.env`.
2. Replace both example database passwords with strong, unique values. Generate a separate one-time setup token, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, and set `SETUP_TOKEN` in `.env`. Keep `.env` private; it is ignored by Git.
3. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

4. Check the database connection:

   ```powershell
   npm run db:check
   ```

5. Create the KAJUNA BMS tables and indexes:

   ```powershell
   npm run db:migrate
   ```

The migration command is transactional and safe to rerun. Applied migration versions are recorded in `schema_migrations`. The API session table and initial subscription plan are added by migration `002_auth_sessions`; verified Google identity columns are added by `003_google_authentication`. Migrations `004_money_currencies` and `005_subscription_plan_currency` track the denomination of stored monetary values and subscription plan prices; migration `006_transaction_exchange_snapshots` stores rate and converted-value snapshots for sales and expenses.

## Run the application

Start PostgreSQL as above, then run:

```powershell
npm run dev
```

This starts the API on `127.0.0.1:3001` and the Vite frontend on `http://localhost:5173`; Vite proxies `/api` requests to the backend. The first user registers a business and business administrator from the sign-in screen using the one-time `SETUP_TOKEN`. After setup, the token cannot create another initial administrator.

Sign-in determines the account role from the matching email and password; there is no role selector. Sessions use random, hashed server-side tokens in HttpOnly, SameSite cookies. The API checks request origin, validates input, rate-limits sign-in and registration, and sets tenant context inside each database transaction so PostgreSQL row-level security remains active. Set `APP_ORIGIN` to the exact frontend origin, or provide multiple exact origins in the comma-separated `APP_ORIGINS` setting when local frontend URLs vary; wildcard origins are not accepted. Agents can create sales but cannot access administrator reports or manage staff.

The system owner can be created once from the sign-in page using **Set up the system owner account** and the `SETUP_TOKEN`. Alternatively, set `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD` in the server's private `.env` file to create the owner on API startup when no platform owner exists; `PLATFORM_OWNER_NAME` is optional. The password is hashed before being stored in PostgreSQL. Existing owner accounts are never changed by editing these environment values. If the configured email belongs to a business-admin account, the API will not change it unless `PLATFORM_OWNER_PROMOTE_EXISTING=true`. With that explicit setting, the existing business account is disabled and its sessions revoked, then a separate platform-owner account is created with the configured credentials. This preserves the business account's links to historical records. Use that setting only with explicit authorization. After setup, sign in with the owner's email and password to review businesses, subscription periods, payment activity, suspend or reactivate access, or permanently delete a customer business. Permanent deletion requires the owner's current password, deletes the business and its associated users and records, and is recorded in a platform-level audit entry. It cannot be undone. Suspending a business signs out all of its users and blocks further sign-ins; the owner account is separate from any business.

Business registration after first setup is stored as a pending platform review request. Optional Google sign-in and Google-backed business registration require a Google OAuth web client ID in `GOOGLE_CLIENT_ID`; restart the API after adding it to `.env`. Google credentials are verified by the API, linked only to accounts with the same verified email, and protected against duplicate account/registration creation. Password reset email delivery is not configured; administrators must handle password recovery until an email service is added.

### Google Sign-In setup

1. In Google Cloud Console, select or create a project and configure the OAuth consent screen (branding, support email, and audience). Add authorized test users while the app is in Testing.
2. Create an OAuth client with application type **Web application**.
3. Add the exact frontend origin under **Authorized JavaScript origins** (for local development, `http://localhost:5173`; add your production origin when deployed). This flow uses Google Identity Services ID tokens and does not need an authorized redirect URI.
4. Copy the client ID (the public `...apps.googleusercontent.com` value, not a client secret) into `GOOGLE_CLIENT_ID` in `.env`, then restart the API and frontend.
5. Verify the frontend displays the Google button and try sign-in/registration with a Google account listed as a test user if the consent screen is still in Testing.

To run API/database integration tests, use:

```powershell
npm run test:api
```

This creates a uniquely named temporary PostgreSQL database, applies the migrations, runs API and row-level-security tests, and drops that temporary database afterward. The configured migration role must be allowed to create databases.

For a managed PostgreSQL instance, set `DATABASE_URL` to the application-role connection string and `MIGRATION_DATABASE_URL` to a schema-owner connection string, then run steps 4 and 5.

## Database model

The initial migration defines:

- Businesses and business registration requests
- Platform admins, business admins, and sales agents
- Business-scoped categories and products, including buying/selling price, stock, and reorder level
- Stock movement history
- Sales and sale line items, with stored cost/selling-price snapshots and database-calculated gross profit
- Expenses, subscription plans, business subscriptions, and payments
- Audit logs and platform settings

Tenant-owned tables use PostgreSQL row-level security. Business data is scoped using the transaction setting `app.business_id`; platform-wide operations use `app.is_platform_admin = 'true'`. The runtime database role must not own the tables or have `BYPASSRLS`. Set tenant context inside a transaction with `SET LOCAL app.business_id = '<authenticated-business-uuid>'`. Never take a tenant ID from an untrusted request without checking it against the authenticated session.

Business currency changes preserve original database amounts and transaction history. The supported currencies are TZS, KES, UGX, USD, EUR, and GBP. New sales and expenses store the original amount and currency, the rate, the converted amount/currency, the provider's rate snapshot, and its update time. Historic reports convert using each record's saved snapshot, so refreshing rates does not rewrite historical values. Inventory prices and on-demand conversions use the latest available reference rate. When changing the business currency, administrators must confirm a one-time snapshot for legacy sales/expenses that predate saved rates; original amounts are not changed.

Rates come from the no-key ExchangeRate-API Open Access endpoint (`https://open.er-api.com/v6/latest/USD`), are cached until the provider's stated next update, and are fetched only by the backend. The settings page displays rate timestamps and warns when a cached rate is stale or unavailable. Cached stale rates may be used for up to seven days and are marked on new records; if no usable rates are available, a conversion-dependent operation fails explicitly. These are daily reference rates, not guaranteed bank or payment-settlement rates. The System Settings page includes an authenticated amount converter for any pair of the six currencies.

## API and database coverage

The backend exposes authenticated endpoints for business setup and profile, products and inventory movements, categories, sales and receipts, expenses, staff accounts, dashboard metrics, and subscription status. Tenant data is queried through the application database role with transaction-local `app.business_id` context; public business registration is restricted by the existing database policy. Product sales and stock movements are committed atomically.

For production, serve the built frontend and proxy `/api` to the Node API on the same origin. Set `APP_ORIGIN` to the public application origin, use HTTPS, keep the setup token and database credentials private, and do not run the API with the schema-owner database credentials.

## Existing UI commands

- `npm run dev` — start the Vite development server
- `npm run build` — create a production frontend build
- `npm run lint` — lint the application
