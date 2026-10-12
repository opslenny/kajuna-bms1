-- Business account management: suspension reason/status and billing queries.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

CREATE INDEX IF NOT EXISTS businesses_status_idx ON businesses (status);
CREATE INDEX IF NOT EXISTS subscriptions_business_period_idx ON subscriptions (business_id, current_period_end);
CREATE INDEX IF NOT EXISTS payments_business_status_idx ON payments (business_id, status, created_at DESC);