ALTER TABLE businesses
  ADD COLUMN logo_data BYTEA,
  ADD COLUMN logo_mime_type TEXT,
  ADD COLUMN logo_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT businesses_logo_size_check
    CHECK (logo_data IS NULL OR octet_length(logo_data) <= 5242880),
  ADD CONSTRAINT businesses_logo_mime_check
    CHECK (logo_mime_type IS NULL OR logo_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT businesses_logo_consistency_check
    CHECK ((logo_data IS NULL) = (logo_mime_type IS NULL) AND (logo_data IS NULL) = (logo_updated_at IS NULL));
