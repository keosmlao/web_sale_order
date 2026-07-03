-- Append-only change history for commission bases.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS app_incentive_role_commission_audit (
  id            BIGSERIAL PRIMARY KEY,
  position_code TEXT NOT NULL,
  group_code    TEXT NOT NULL,
  old_amount    NUMERIC NOT NULL,
  new_amount    NUMERIC NOT NULL,
  changed_by    VARCHAR(20),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_role_commission_audit_changed
  ON app_incentive_role_commission_audit (changed_at DESC);
