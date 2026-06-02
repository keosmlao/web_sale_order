-- Per-role sidebar menu visibility.
--
-- Opt-out model: a menu item is visible to a role UNLESS an explicit row
-- exists here hiding it. Absence of a row = visible (so new menus appear
-- automatically and the table only stores the exceptions an admin sets).
--
-- menu_key matches the sidebar item key (its href, e.g. "/inventory", or a
-- group id). role is one of the four app roles. Managed by managers only via
-- /settings/menu-visibility.

CREATE TABLE IF NOT EXISTS app_menu_visibility (
  menu_key   VARCHAR(120) NOT NULL,
  role       VARCHAR(20)  NOT NULL,
  updated_by VARCHAR(20),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu_key, role),
  CONSTRAINT app_menu_visibility_role_chk
    CHECK (role IN ('pc', 'salesperson', 'head', 'manager'))
);

CREATE INDEX IF NOT EXISTS app_menu_visibility_role_idx
  ON app_menu_visibility (role);
