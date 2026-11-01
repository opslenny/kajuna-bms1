# KAJUNA BMS

KAJUNA BMS is a React/Vite business management application. The PostgreSQL schema and migration tooling are in `server/db`.

## Local development (Supabase only)

KAJUNA BMS uses **Supabase PostgreSQL** as its only database. There is no
Docker container and no local database server to run.

1. Copy `.env.example` to `.env` and fill in your Supabase connection strings
   and secrets (see `.env.example` and `DEPLOYMENT.md`).
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Check the database connection:

   ```powershell
   npm run db:check
   ```

4. Apply database migrations (safe to rerun):

   ```powershell
   npm run db:migrate
   ```

5. Start the app (API on 127.0.0.1:3001, Vite on http://localhost:5173):

   ```powershell
   npm run dev
   ```

6. Build for production:

   ```powershell
   npm run build
   ```

Both localhost and Vercel connect to the SAME Supabase project.

## Run the application

Start PostgreSQL as above, then run:

```powershell
npm run dev
```

This starts the API on `127.0.0.1:3001` and the Vite frontend on `http://localhost:5173`; Vite proxies `/api` requests to the backend. Registering a business creates a **pending application**; access to the Business Admin Panel is only granted after the system owner approves it from the Owner Console.

The authenticated workspaces provide a collapsible, scrollable navigation drawer and account-level appearance preferences. Use the header controls (or the Business Admin **Settings** page) to switch between light/dark themes and English/Kiswahili; choices are saved independently on the signed-in user's account and restored on later sign-ins. Navigation remains scoped to the existing owner, business-admin, and sales-agent workspaces. Sales agents can use their hamburger menu to start a sale, add items to an existing customer's debt, review their account details, change their password, record an expense, or sign out. Changing a password requires the current password, keeps the current session active, and ends other sessions for that account.

Sign-in determines the account role from the matching email and password; there is no role selector. Sessions use random, hashed server-side tokens in HttpOnly, SameSite cookies. The API checks request origin, validates input, rate-limits sign-in and registration, and sets tenant context inside each database transaction so PostgreSQL row-level security remains active. Set `APP_ORIGIN` to the exact frontend origin, or provide multiple exact origins in the comma-separated `APP_ORIGINS` setting when local frontend URLs vary; wildcard origins are not accepted. Sales agents can create sales, add debt items for existing customers, and record business expenses from their workspace, but cannot register customers, browse the administrator expense list, access administrator reports, or manage staff.

The system owner can be created once from the sign-in page using **Set up the system owner account** and the `SETUP_TOKEN`. Alternatively, set `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD` in the server's private `.env` file to create the owner on API startup when no platform owner exists; `PLATFORM_OWNER_NAME` is optional. The password is hashed before being stored in PostgreSQL. Existing owner accounts are never changed by editing these environment values. If the configured email belongs to a business-admin account, the API will not change it unless `PLATFORM_OWNER_PROMOTE_EXISTING=true`. With that explicit setting, the existing business account is disabled and its sessions revoked, then a separate platform-owner account is created with the configured credentials. This preserves the business account's links to historical records. Use that setting only with explicit authorization. After setup, sign in with the owner's email and password to review businesses, subscription periods, payment activity, suspend or reactivate access, or permanently delete a customer business. Permanent deletion requires the owner's current password, deletes the business and its associated users and records, and is recorded in a platform-level audit entry. It cannot be undone. Suspending a business signs out all of its users and blocks further sign-ins; the owner account is separate from any business.

### Business registration & approval

Every business registration is stored as a **pending application** and is not granted access automatically — including the first business on a fresh system. The system owner reviews applications from the **Applications & approvals** section of the Owner Console and approves or rejects each one. The registration form no longer needs the `SETUP_TOKEN`; that key is used only when creating the system owner account.

- **Pending** applications cannot sign in with email/password or Google; login returns a clear message that the application is awaiting review.
- **Approved** applications create the business account (active status) plus one business administrator and a Business Growth subscription, and the owner can sign in immediately.
- **Rejected** applications are blocked forever; login returns a clear message to contact the system administrator.

Approvals and rejections are written to the platform audit log (`platform_business_application_approved` / `platform_business_application_rejected`) with the reviewer and timestamp. Login, session restoration, and every protected route re-check the account and business status on each request, so direct-URL access to the Business Admin Panel is useless until an application is approved. Optional Google sign-in and Google-backed business registration require a Google OAuth web client ID in `GOOGLE_CLIENT_ID`; restart the API after adding it to `.env`. Google credentials are verified by the API, linked only to accounts with the same verified email, and protected against duplicate account/registration creation. Password recovery is administrator-assisted and does not require an email service; see [Password recovery](#password-recovery).

### Account management, billing & payments

The Owner Console is the single place where the system owner manages business accounts. All of these actions are platform-admin only, validate their inputs, and are written to the audit log with the acting admin, action, timestamp, and affected account.

- **Customer accounts list.** The **Businesses & subscriptions** view shows each business and owner, registration date, approval and account status, subscription fee, payment status, due/next payment dates, outstanding balance, and available details/actions. Applications still awaiting approval — or approved but with no live business account — appear at the top of the list marked **Awaiting approval** or **Approved (no business account yet)** until they are reviewed from the Applications & approvals queue. Use the search box and the account/payment filters to narrow the list; overdue accounts are highlighted and counted in the Overdue stat. No account actions appear in the list — the **⋮** menu beside each business opens its **Business Details** page. The Back button returns to the list with search and filters intact.
- **Business Details page.** Opened from the ⋮ menu for a specific business. The top card shows the owner's full name, email and phone, registration (or application) date, subscription plan and monthly fee, payment status and last payment, plus approval, access, and payment badges. A **Subscription & billing** section holds **Record payment** and **Verify payment**, and the clearly separated **Account management actions** section holds **Suspend / Reactivate account**, **Reset admin password**, and **Delete permanently**. Pending accounts instead show an **Awaiting approval** panel with a **Review in Applications & approvals** button — none of the sensitive actions apply until the business is approved.
- **Suspend / reactivate.** **Suspend** asks for a reason, signs the business's users out of every session, and blocks all sign-ins until **Reactivate** is used. The suspension reason and date are stored on the business and shown in the overview; the reactivation clears them. Both actions are audited (`platform_business_suspended` / `platform_business_active`).
- **Permanent deletion.** **Delete permanently** (on the Business Details page) requires the owner's current password (verified against the hash in PostgreSQL) and explicit confirmation. It removes the business, registration credentials, users, products, sales, expenses, subscriptions, payments, and other tenant records via the schema's foreign-key relationships, and is audited as `platform_business_deleted` in the platform-level audit log. A deleted user can never sign in again because their account and sessions are gone with the business.
- **Subscription settings.** The **Subscription settings** view sets the monthly subscription fee (amount and currency) and the payment grace period (days). The fee is stored on the active monthly plan in `subscription_plans`; new billing periods use the current fee, while existing invoices and recorded payments keep the amount they were charged. Changing the plan price never rewrites past payments.
- **Payment tracking.** **Record payment** creates a payment row as *pending* (amount, invoice currency, method, optional reference); the backend prevents overpayment and only accepts the current invoice's currency. **Verify payment** marks it *succeeded* with a paid timestamp and applies the credit. Partial payments reduce the outstanding balance; the subscription period advances and snapshots the current plan fee only once the invoice is fully covered. Both steps are audited (`platform_payment_recorded` / `platform_payment_verified`). Payment status per account: *Paid* (period in good standing), *Pending* (payment due within its grace period or awaiting verification), *Overdue* (past the due date plus the configured grace period), *Suspended* (account access disabled).
- **Overdue handling.** Subscriptions whose payment is past the due date plus the configurable grace period are flagged **Overdue**, appear in the overview and the Overdue stat, and can be suspended manually for non-payment. Reactivation is available after the payment is verified or whenever the owner authorizes it. Automatic suspension is intentionally not enabled; the grace period is configurable in Subscription settings for when it is needed.

### Customer Debts (credit sales)

The **Debts** area of the Business Admin Panel sells on credit and tracks what each customer owes. One profile per customer is shared by every credit line and payment, so the same customer is never registered twice for the same business.

- **Debtors register.** The **Customer Debts** dashboard lists every customer: full name, phone, optional address, total debt, amount paid, outstanding balance, last transaction date, and status (*Unpaid* / *Partially paid* / *Fully paid*). Search by name or phone, and filter by the three statuses. **Add Customer** opens a register dialog; business administrators and sales agents can create profiles, while profile edits remain restricted to business administrators. The sales-agent debit flow can create a customer and continue directly to adding debt items.
- **Add Debt / Add Items.** From a customer's details page, **Add Debt** records one or more lines on any date. Lines pick a product from inventory (the selling price is fetched automatically, totals are computed, and stock is deducted once at issue as a credit sale — not a cash sale) or a manual item name and unit price for services and one-off charges. The customer's total debt and outstanding balance increase immediately. Issuing goods that would take stock below zero is rejected, and each credit sale appears in sales history with the customer's name and an *Unpaid* / *Partially paid* payment status.
- **Payments.** **Record payment** accepts full or partial payments and optionally backdates them; paid, balance, and status update instantly and the payment is kept in the payment history. Payments are tagged with a unique client reference so re-submitting the same payment never records it twice, and a payment larger than the outstanding balance is rejected.
- **Customer details.** The detail page shows the profile, every credit item with its date, quantity, unit price, and notes, the payment history, and live totals. Business admins can edit the profile and correct or void individual debt lines. Corrections keep the linked inventory sale and stock in sync, restore stock when a line is voided or shrinks, and are recorded in the audit log so the history is never silently rewritten. Voiding a line whose removal would leave recorded payments above the remaining debt is blocked.
- **Reports.** The **Debt Reports** view summarizes total debt, collected, and outstanding, counts each status, and lists overdue customers (default cutoff 30 days) with their balance. All amounts respect the business currency and date format, and reports only ever cover the signed-in business's own records.

Debt balances and payment status are recomputed transactionally on every change (`refreshCustomerBalances`), and the linked credit sales' payment statuses are flipped to match (*unpaid* → *partial* → *paid*). Deleting a customer voids their remaining credit sales, returns any inventory goods back to stock, and then removes the customer's records.

### Password recovery

KAJUNA BMS does not send password reset email, so recovery is administrator-assisted. All three paths sign the affected account out of every active session, and the new password must be 8–128 characters.

- **Sales agents:** a business administrator opens the sales agents list and uses **Reset password**, then shares the new password through a secure channel.
- **Business administrators:** the system owner opens the Owner Console, uses **Reset admin password** for the business, and confirms with their own owner password.
- **System owner:** run the recovery command on the server that hosts the API. Set `NEW_OWNER_PASSWORD` (or reuse `PLATFORM_OWNER_PASSWORD`) in `.env`, then run `npm run owner:reset-password`. Pass an email argument to target a specific owner, for example `npm run owner:reset-password -- owner@example.com`; it defaults to `PLATFORM_OWNER_EMAIL`. Remove `NEW_OWNER_PASSWORD` from `.env` after recovery.

Passwords remain hashed with scrypt; recovery never stores or emails a plaintext password.

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

- Businesses, and business registration requests that form the pending → approved/rejected approval queue reviewed by the system owner
- Platform admins, business admins, and sales agents
- Business-scoped categories and products, including buying/selling price, stock, and reorder level
- Stock movement history
- Sales and sale line items, with stored cost/selling-price snapshots and database-calculated gross profit
- Credit-sale customers, debt transactions, and debt payments, with denormalized balances (total debt, amount paid, status, last transaction date) kept in sync transactionally
- Expenses, subscription plans, business subscriptions, and payments
- Audit logs and platform settings

Tenant-owned tables use PostgreSQL row-level security. Business data is scoped using the transaction setting `app.business_id`; platform-wide operations use `app.is_platform_admin = 'true'`. The runtime database role must not own the tables or have `BYPASSRLS`. Set tenant context inside a transaction with `SET LOCAL app.business_id = '<authenticated-business-uuid>'`. Never take a tenant ID from an untrusted request without checking it against the authenticated session.

Business currency changes preserve original database amounts and transaction history. The supported currencies are TZS, KES, UGX, USD, EUR, and GBP. New sales and expenses store the original amount and currency, the rate, the converted amount/currency, the provider's rate snapshot, and its update time. Historic reports convert using each record's saved snapshot, so refreshing rates does not rewrite historical values. Inventory prices and on-demand conversions use the latest available reference rate. When changing the business currency, administrators must confirm a one-time snapshot for legacy sales/expenses that predate saved rates; original amounts are not changed.

Rates come from the no-key ExchangeRate-API Open Access endpoint (`https://open.er-api.com/v6/latest/USD`), are cached until the provider's stated next update, and are fetched only by the backend. The settings page displays rate timestamps and warns when a cached rate is stale or unavailable. Cached stale rates may be used for up to seven days and are marked on new records; if no usable rates are available, a conversion-dependent operation fails explicitly. These are daily reference rates, not guaranteed bank or payment-settlement rates. The System Settings page includes an authenticated amount converter for any pair of the six currencies.

## API and database coverage

The backend exposes authenticated endpoints for business setup and profile, account preferences and password changes, products and inventory movements, categories, sales and receipts, expenses, staff accounts, customer debts (customers, debt transactions, payments, and debt/customer reports), dashboard metrics, and subscription status. The Owner Console lists and approves/rejects pending business applications (`/platform/applications`), manages business access and permanent deletion (`/platform/businesses`), reads and updates subscription settings (`/platform/subscription-settings`), and records/verifies payments (`/platform/businesses/:id/payments`, `/platform/payments/:id/verify`). Tenant data is queried through the application database role with transaction-local `app.business_id` context; public business registration is restricted by the existing database policy. Product sales and stock movements are committed atomically.

Business admins can add an optional product image when creating a product, then replace or remove it from Product stock. PNG, JPEG, and WebP uploads default to 5 MB per image; set `MAX_PRODUCT_IMAGE_BYTES` to change the API limit. Product images are tenant-scoped and appear in inventory, POS catalog cards, and the cart. Migrations `015_product_images` and `016_product_images_in_database` add image metadata and store product image bytes in PostgreSQL. Product images therefore persist across API restarts and serverless instances without a local uploads directory or extra storage credentials. Include PostgreSQL in backups; database storage grows by up to the configured upload limit for each product image. Business logos and profile photos continue to use `IMAGE_STORAGE_DIR` and, when configured, the Supabase Storage adapter described in [Supabase, Vercel, and Namecheap deployment](./DEPLOYMENT.md).

Business admins can upload or remove a business logo in Business Profile settings. PNG, JPEG, and WebP images up to 5 MB are stored with the business and served only to authenticated users from that business; both business-admin and sales-agent panels display the current business name and logo. Users in each workspace can upload or remove their own profile photo; profile images are scoped to the authenticated user and shown in the header/sidebar. Migration `011_business_branding` adds logo support and migration `014_persistent_user_images` adds file references for persistent image storage. Image files live in `IMAGE_STORAGE_DIR` (default: `data/images`), separate from PostgreSQL. For Vercel deployments, configure the private Supabase Storage adapter (`IMAGE_STORAGE_PROVIDER=supabase`) and migrate existing image files as described in [Supabase, Vercel, and Namecheap deployment](./DEPLOYMENT.md).

For production, serve the built frontend and proxy `/api` to the Node API on the same origin. Set `APP_ORIGIN` to the public application origin, use HTTPS, keep the setup token and database credentials private, and do not run the API with the schema-owner database credentials. See [Supabase, Vercel, and Namecheap deployment](./DEPLOYMENT.md) for deployment and data-migration steps.

## Existing UI commands

- `npm run dev` — start the Vite development server
- `npm run build` — create a production frontend build
- `npm run lint` — lint the application
- `npm run owner:reset-password` — reset the system owner password when locked out (see [Password recovery](#password-recovery))
