-- Split the per-promotion "stack with member benefits" toggle into two:
--   awards_points          → line earns loyalty points (existing)
--   awards_member_discount → member % stacks on top of the promo price
--
-- Both default to TRUE so existing rows continue stacking with member
-- benefits — same effective behavior as before the split.

ALTER TABLE app_promotion
  ADD COLUMN IF NOT EXISTS awards_member_discount BOOLEAN NOT NULL DEFAULT TRUE;
