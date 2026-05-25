-- Make app_price_request usable as a standalone (cart-less) record.
-- Standalone requests are created from the dedicated "Price Request" menu
-- BEFORE the sale order exists. Once approved, the next sale order created
-- for the same customer+item auto-applies the approved price.
--
-- Legacy cart-bound requests still work — cart_number is just optional now.

ALTER TABLE app_price_request
  ALTER COLUMN cart_number DROP NOT NULL;

ALTER TABLE app_price_request
  ALTER COLUMN requested_price DROP NOT NULL;

ALTER TABLE app_price_request
  ADD COLUMN IF NOT EXISTS customer_code VARCHAR(20);

-- Lookup: "do we have an approved price for this customer+item that has
-- not been consumed yet?" — used by the create-order flow on cart-add.
CREATE INDEX IF NOT EXISTS idx_app_price_request_customer_item_status
  ON app_price_request (customer_code, item_code, status);
