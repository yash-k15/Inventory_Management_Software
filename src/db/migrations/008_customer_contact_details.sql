-- Add optional business contact details to customers.
-- Existing customer records remain valid with NULL values.

ALTER TABLE customer ADD COLUMN email TEXT;
ALTER TABLE customer ADD COLUMN city TEXT;
ALTER TABLE customer ADD COLUMN address TEXT;