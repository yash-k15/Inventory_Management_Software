
ALTER TABLE customer_order
ADD COLUMN notes TEXT NOT NULL DEFAULT '';

ALTER TABLE customer_order
ADD COLUMN calculated_total_paise INTEGER NOT NULL DEFAULT 0
CHECK (calculated_total_paise >= 0);

ALTER TABLE customer_order
ADD COLUMN rounded_total_paise INTEGER
CHECK (rounded_total_paise IS NULL OR rounded_total_paise >= 0);
