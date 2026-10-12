-- Business approval management.
--
-- Every business registration is stored in business_registration_requests with
-- status pending -> approved | rejected (already enforced by the table CHECK in
-- migration 001). The system owner reviews the queue from the Owner Console and
-- approves or rejects each application. This migration only adds an index for
-- the owner review queue; no schema change is required.

CREATE INDEX IF NOT EXISTS business_registration_requests_review_idx
  ON business_registration_requests (status, created_at DESC);