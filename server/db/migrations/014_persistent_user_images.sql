ALTER TABLE businesses
  ADD COLUMN logo_storage_key TEXT,
  ADD COLUMN logo_storage_mime_type TEXT;

ALTER TABLE businesses
  DROP CONSTRAINT businesses_logo_consistency_check,
  ADD CONSTRAINT businesses_logo_storage_mime_check
    CHECK (logo_storage_mime_type IS NULL OR logo_storage_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT businesses_logo_storage_consistency_check
    CHECK (
      (logo_data IS NULL) = (logo_mime_type IS NULL)
      AND (logo_storage_key IS NULL) = (logo_storage_mime_type IS NULL)
      AND NOT (logo_data IS NOT NULL AND logo_storage_key IS NOT NULL)
      AND ((logo_data IS NULL AND logo_storage_key IS NULL) = (logo_updated_at IS NULL))
      AND (logo_storage_key IS NULL OR logo_storage_key ~ '^businesses/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp)$')
    );

ALTER TABLE users
  ADD COLUMN profile_image_storage_key TEXT,
  ADD COLUMN profile_image_mime_type TEXT,
  ADD COLUMN profile_image_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT users_profile_image_mime_check
    CHECK (profile_image_mime_type IS NULL OR profile_image_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT users_profile_image_consistency_check
    CHECK (
      (profile_image_storage_key IS NULL) = (profile_image_mime_type IS NULL)
      AND (profile_image_storage_key IS NULL) = (profile_image_updated_at IS NULL)
      AND (profile_image_storage_key IS NULL OR profile_image_storage_key ~ ('^users/' || id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$'))
    );
