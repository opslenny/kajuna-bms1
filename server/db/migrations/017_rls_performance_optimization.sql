-- 017_rls_performance_optimization.sql
--
-- Optimizes all tenant_isolation and platform_admin_only RLS policies by
-- wrapping current_setting() calls in scalar subqueries. This forces
-- PostgreSQL to evaluate the session variables once per statement instead
-- of once per row, eliminating the "Auth RLS Initialization Plan" linter
-- warning and improving query performance on large tables.
--
-- Security: no change to access rules — USING/WITH CHECK logic is identical.
-- All policies are replaced atomically (DROP + CREATE in same transaction).

BEGIN;

-- ─── 1. TENANT TABLES (business_id column) ──────────────────────────────────
-- Tables: users, categories, products, stock_movements, sales, sale_items,
--         expenses, subscriptions, payments, audit_logs,
--         customers, debt_transactions, debt_payments

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'categories', 'products', 'stock_movements', 'sales',
    'sale_items', 'expenses', 'subscriptions', 'payments', 'audit_logs',
    'customers', 'debt_transactions', 'debt_payments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      $pol$
      CREATE POLICY tenant_isolation ON %I
        USING (
          (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
          OR business_id = (SELECT nullif(current_setting('app.business_id', true), '')::uuid)
        )
        WITH CHECK (
          (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
          OR business_id = (SELECT nullif(current_setting('app.business_id', true), '')::uuid)
        )
      $pol$,
      t
    );
  END LOOP;
END;
$$;

-- ─── 2. BUSINESSES TABLE (id column, not business_id) ───────────────────────

DROP POLICY IF EXISTS tenant_isolation ON businesses;
CREATE POLICY tenant_isolation ON businesses
  USING (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
    OR id = (SELECT nullif(current_setting('app.business_id', true), '')::uuid)
  )
  WITH CHECK (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
    OR id = (SELECT nullif(current_setting('app.business_id', true), '')::uuid)
  );

-- ─── 3. PLATFORM-ADMIN-ONLY TABLES ──────────────────────────────────────────

DROP POLICY IF EXISTS platform_admin_only ON business_registration_requests;
CREATE POLICY platform_admin_only ON business_registration_requests
  USING (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  )
  WITH CHECK (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  );

DROP POLICY IF EXISTS platform_admin_only ON platform_settings;
CREATE POLICY platform_admin_only ON platform_settings
  USING (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  )
  WITH CHECK (
    (SELECT coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  );

-- ─── 4. PUBLIC INSERT POLICY (unchanged — no current_setting calls) ─────────
-- public_registration_requests on business_registration_requests is already
-- optimal: FOR INSERT WITH CHECK (status = 'pending' AND ...) — no change needed.

COMMIT;
