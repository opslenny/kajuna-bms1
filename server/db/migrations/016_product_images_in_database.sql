ALTER TABLE products
  ADD COLUMN product_image_data BYTEA,
  DROP CONSTRAINT products_product_image_consistency_check,
  ADD CONSTRAINT products_product_image_consistency_check
    CHECK (
      ((product_image_storage_key IS NOT NULL)::integer + (product_image_data IS NOT NULL)::integer) <= 1
      AND ((product_image_storage_key IS NOT NULL OR product_image_data IS NOT NULL) = (product_image_mime_type IS NOT NULL))
      AND ((product_image_storage_key IS NOT NULL OR product_image_data IS NOT NULL) = (product_image_updated_at IS NOT NULL))
      AND (product_image_data IS NULL OR octet_length(product_image_data) > 0)
      AND (product_image_storage_key IS NULL OR product_image_storage_key ~ ('^products/' || id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$'))
    );
