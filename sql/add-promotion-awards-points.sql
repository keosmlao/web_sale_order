-- Add the awards_points flag to app_promotion so managers can toggle per-
-- promotion whether the sale lines created by it accrue loyalty points.
-- Default TRUE so existing rows keep awarding points unchanged.

ALTER TABLE app_promotion
  ADD COLUMN IF NOT EXISTS awards_points BOOLEAN NOT NULL DEFAULT TRUE;
