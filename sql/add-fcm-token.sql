-- One row per (employee, device) so a manager logged in on phone + tablet
-- gets the notification on both. Unique on token so re-registration from the
-- same device just refreshes the row (employee/platform/last_seen update).

CREATE TABLE IF NOT EXISTS app_fcm_token (
  id              BIGSERIAL PRIMARY KEY,
  employee_code   VARCHAR(20)  NOT NULL,
  token           TEXT         NOT NULL UNIQUE,
  platform        VARCHAR(10),                  -- 'android' | 'ios' | 'web'
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_fcm_token_employee
  ON app_fcm_token (employee_code);
