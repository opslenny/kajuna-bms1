ALTER TABLE products
  ADD COLUMN product_image_storage_key TEXT,
  ADD COLUMN product_image_mime_type TEXT,
  ADD COLUMN product_image_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT products_product_image_mime_check
    CHECK (product_image_mime_type IS NULL OR product_image_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT products_product_image_consistency_check
    CHECK (
      (product_image_storage_key IS NULL) = (product_image_mime_type IS NULL)
      AND (product_image_storage_key IS NULL) = (product_image_updated_at IS NULL)
      AND (product_image_storage_key IS NULL OR product_image_storage_key ~ ('^products/' || id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$'))
    );
