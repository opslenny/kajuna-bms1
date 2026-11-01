CREATE INDEX IF NOT EXISTS sales_business_created_status_idx ON sales (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS expenses_business_date_category_idx ON expenses (business_id, expense_date, category);
CREATE INDEX IF NOT EXISTS debt_payments_business_received_idx ON debt_payments (business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sale_items_business_sale_idx2 ON sale_items (business_id, sale_id);
