-- Append-only audit trail for app_promotion. Captures who created /
-- updated / deleted each promo + a JSON snapshot of the row state. The
-- promotions admin UI writes one row per save (and a 'delete' row when
-- a promo is removed) so a manager can see what changed without diving
-- into raw DB logs.

CREATE TABLE IF NOT EXISTS app_promotion_audit (
  id              BIGSERIAL    PRIMARY KEY,
  promotion_id    BIGINT       NOT NULL,
  action          VARCHAR(20)  NOT NULL,
  actor_code      VARCHAR(20)  NOT NULL,
  snapshot        JSONB        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_promotion_audit_promo
  ON app_promotion_audit (promotion_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_promotion_audit_created
  ON app_promotion_audit (created_at DESC);
