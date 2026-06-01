-- Live presence + device telemetry for the sales mobile app. One row per
-- employee (latest device to report wins). The Flutter app upserts this on
-- activity only -- login, app resume, screen change -- never on a background
-- timer. A row counts as "online" when last_seen_at is recent; the
-- /api/monitor/devices endpoint applies the freshness threshold. Managers and
-- heads view it in the /monitor dashboard.

CREATE TABLE IF NOT EXISTS app_device_presence (
  employee_code   VARCHAR(20)  PRIMARY KEY,
  online          BOOLEAN      NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  platform        VARCHAR(10),
  app_version     VARCHAR(40),
  device_model    VARCHAR(160),
  os_version      VARCHAR(60),
  battery_pct     INTEGER,
  charging        BOOLEAN,
  current_screen  VARCHAR(80),
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  location_at     TIMESTAMPTZ,
  device_id       VARCHAR(200),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_device_presence_online
  ON app_device_presence (online, last_seen_at);
