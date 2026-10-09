CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);

INSERT INTO subscription_plans (name, description, price, billing_period, features)
VALUES (
  'Business Growth',
  'Core inventory, sales, and business reporting',
  199000,
  'monthly',
  '["Unlimited products", "Multi-user access", "Advanced reporting"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;
