CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  industry TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TZS',
  timezone TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'business_admin', 'sales_agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  CHECK (
    (role = 'platform_admin' AND business_id IS NULL)
    OR (role IN ('business_admin', 'sales_agent') AND business_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS users_platform_admin_email_unique
  ON users (lower(email)) WHERE business_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_business_email_unique
  ON users (business_id, lower(email)) WHERE business_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  industry TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_registration_email_unique
  ON business_registration_requests (lower(email));

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_business_name_unique
  ON categories (business_id, lower(name));

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  description TEXT,
  buying_price NUMERIC(14, 2) NOT NULL CHECK (buying_price >= 0),
  selling_price NUMERIC(14, 2) NOT NULL CHECK (selling_price > buying_price),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, category_id)
    REFERENCES categories (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS products_business_sku_unique
  ON products (business_id, lower(sku));
CREATE INDEX IF NOT EXISTS products_business_name_idx ON products (business_id, name);
CREATE INDEX IF NOT EXISTS products_low_stock_idx ON products (business_id, quantity, reorder_level);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  performed_by UUID,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'restock', 'sale', 'adjustment', 'return')),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  unit_cost NUMERIC(14, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id),
  FOREIGN KEY (business_id, performed_by) REFERENCES users (business_id, id)
);

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in customer',
  customer_phone TEXT,
  sold_by UUID,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'voided', 'refunded')),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer', 'other')),
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, receipt_number),
  FOREIGN KEY (business_id, sold_by) REFERENCES users (business_id, id)
);

CREATE INDEX IF NOT EXISTS sales_business_created_idx ON sales (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_business_status_idx ON sales (business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_buying_price NUMERIC(14, 2) NOT NULL CHECK (unit_buying_price >= 0),
  unit_selling_price NUMERIC(14, 2) NOT NULL CHECK (unit_selling_price >= 0),
  line_total NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_selling_price) STORED,
  gross_profit NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * (unit_selling_price - unit_buying_price)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id)
);

CREATE INDEX IF NOT EXISTS sale_items_business_sale_idx ON sale_items (business_id, sale_id);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recorded_by UUID,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, recorded_by) REFERENCES users (business_id, id)
);

CREATE INDEX IF NOT EXISTS expenses_business_date_idx ON expenses (business_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  price NUMERIC(14, 2) NOT NULL CHECK (price >= 0),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'quarterly', 'yearly')),
  max_users INTEGER CHECK (max_users IS NULL OR max_users > 0),
  max_products INTEGER CHECK (max_products IS NULL OR max_products > 0),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE INDEX IF NOT EXISTS subscriptions_business_status_idx ON subscriptions (business_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subscription_id UUID,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'TZS',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mobile_money', 'card', 'bank_transfer', 'cash', 'other')),
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, subscription_id)
    REFERENCES subscriptions (business_id, id) ON DELETE SET NULL (subscription_id)
);

CREATE INDEX IF NOT EXISTS payments_business_created_idx ON payments (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, actor_user_id) REFERENCES users (business_id, id) ON DELETE SET NULL (actor_user_id)
);

CREATE INDEX IF NOT EXISTS audit_logs_business_created_idx ON audit_logs (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'users', 'categories', 'products', 'stock_movements', 'sales',
    'sale_items', 'expenses', 'subscriptions', 'payments', 'audit_logs'
  ]
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

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON businesses
  USING (
    coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean
    OR id = nullif(current_setting('app.business_id', true), '')::uuid
  )
  WITH CHECK (
    coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean
    OR id = nullif(current_setting('app.business_id', true), '')::uuid
  );

ALTER TABLE business_registration_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_only ON business_registration_requests
  USING (coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  WITH CHECK (coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean);
CREATE POLICY public_registration_requests ON business_registration_requests
  FOR INSERT WITH CHECK (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_only ON platform_settings
  USING (coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean)
  WITH CHECK (coalesce(current_setting('app.is_platform_admin', true), 'false')::boolean);
