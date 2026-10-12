ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS current_period_currency CHAR(3);

UPDATE subscriptions s
SET current_period_amount = p.price,
    current_period_currency = p.currency
FROM subscription_plans p
WHERE p.id = s.plan_id
  AND (s.current_period_amount IS NULL OR s.current_period_currency IS NULL);

ALTER TABLE subscriptions
  ALTER COLUMN current_period_amount SET NOT NULL,
  ALTER COLUMN current_period_currency SET NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS subscription_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

UPDATE payments pay
SET subscription_period_start = s.current_period_start,
    subscription_period_end = s.current_period_end
FROM subscriptions s
WHERE s.id = pay.subscription_id
  AND s.business_id = pay.business_id
  AND (pay.subscription_period_start IS NULL OR pay.subscription_period_end IS NULL);

CREATE INDEX IF NOT EXISTS payments_subscription_period_idx
  ON payments (subscription_id, subscription_period_start, status)
  WHERE subscription_id IS NOT NULL;
