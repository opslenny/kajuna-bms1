-- Customer Debts (Credit Sales) module
-- One customer profile per business; multiple debt transactions and payments
-- per customer. Balances are derived from debt_transactions/debt_payments and
-- cached on customers for fast dashboards.

-- Required as a foreign-key target for debt_transactions.sale_item_id.
CREATE UNIQUE INDEX IF NOT EXISTS sale_items_business_id_unique ON sale_items (business_id, id);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  total_debt NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_debt >= 0),
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  debt_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (debt_status IN ('unpaid', 'partial', 'paid')),
  currency CHAR(3) NOT NULL DEFAULT 'TZS',
  exchange_rates JSONB,
  last_transaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

-- A phone number identifies a customer within a business: a phone may never be
-- registered twice, which prevents accidental duplicate customer profiles.
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_phone_unique
  ON customers (business_id, lower(phone))
  WHERE phone IS NOT NULL AND trim(phone) <> '';

CREATE INDEX IF NOT EXISTS customers_business_name_idx ON customers (business_id, lower(name));
CREATE INDEX IF NOT EXISTS customers_business_status_idx
  ON customers (business_id, debt_status, last_transaction_at DESC);

-- Each row is one item line taken on credit. Every debt issue event creates one
-- linked credit sale header (sales.sale_item via sale_item_id when the line is
-- an inventory product) so stock is deducted exactly once and the sale appears
-- in sales history as a credit sale (payment_status unpaid/partial/paid).
CREATE TABLE IF NOT EXISTS debt_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  sale_id UUID,
  sale_item_id UUID,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  currency CHAR(3) NOT NULL DEFAULT 'TZS',
  exchange_rate NUMERIC(24, 16),
  converted_total NUMERIC(14, 2),
  converted_currency CHAR(3),
  exchange_rates JSONB,
  fx_rate_updated_at TIMESTAMPTZ,
  fx_rate_is_stale BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE SET NULL,
  FOREIGN KEY (business_id, sale_item_id) REFERENCES sale_items (business_id, id) ON DELETE SET NULL,
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE SET NULL,
  FOREIGN KEY (business_id, created_by) REFERENCES users (business_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS debt_transactions_customer_idx
  ON debt_transactions (business_id, customer_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS debt_transactions_sale_idx
  ON debt_transactions (business_id, sale_id);

CREATE TABLE IF NOT EXISTS debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  recorded_by UUID,
  client_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  currency CHAR(3) NOT NULL DEFAULT 'TZS',
  exchange_rate NUMERIC(24, 16),
  converted_amount NUMERIC(14, 2),
  converted_currency CHAR(3),
  exchange_rates JSONB,
  fx_rate_updated_at TIMESTAMPTZ,
  fx_rate_is_stale BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, recorded_by) REFERENCES users (business_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS debt_payments_customer_idx
  ON debt_payments (business_id, customer_id, received_at DESC);

-- Idempotency guard: a payment submitted twice with the same client reference
-- is never recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS debt_payments_client_reference_unique
  ON debt_payments (business_id, client_reference)
  WHERE client_reference IS NOT NULL;

DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['customers', 'debt_transactions', 'debt_payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (
        coalesce(current_setting(''app.is_platform_admin'', true), ''false'')::boolean
        OR business_id = nullif(current_setting(''app.business_id'', true), '''')::uuid
      ) WITH CHECK (
        coalesce(current_setting(''app.is_platform_admin'', true), ''false'')::boolean
        OR business_id = nullif(current_setting(''app.business_id'', true), '''')::uuid
      )',
      tenant_table
    );
  END LOOP;
END;
$$;