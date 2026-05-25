-- Earlier deployments may have an ic_inventory_barcode table from a
-- pre-release version that lacks the `note`, `created_by`, and
-- `created_at` columns. CREATE TABLE IF NOT EXISTS doesn't add columns
-- to an existing table, so explicitly ALTER each one in if missing.

ALTER TABLE ic_inventory_barcode
  ADD COLUMN IF NOT EXISTS note         TEXT,
  ADD COLUMN IF NOT EXISTS created_by   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
