-- ============================================================================
-- Point-map gap fill — combos that SOLD at the front store this month but had
-- no app_incentive_point_map row, so the seller earned 0 points on them
-- (~250K ບາດ of July-2026 sales, ~40% of the month).
--
-- Every row is seeded with points = 0, so NOTHING changes until someone sets
-- the real points in ຕັ້ງຄ່າ Incentive → ຄະແນນໂບນັດ (the rows now appear
-- there ready to edit). ON CONFLICT DO NOTHING — rows that were added or
-- edited meanwhile are left untouched. Intentionally excluded: spare parts /
-- consumables (refrigerant, copper pipe, welding rods, TV stands) and service
-- pseudo-items.
--
-- Run:  node scripts/apply-sql.mjs sql/add-pointmap-gaps.sql
-- ============================================================================

INSERT INTO app_incentive_point_map (category_code, brand_code, design_token, size_token, points)
VALUES
  -- HITACHI — the whole brand was missing from the map
  ('REF',    'HITACHI',  '1 Door',     '5.0-9.9',   0),
  ('REF',    'HITACHI',  '2 Door',     '5.0-9.9',   0),
  ('REF',    'HITACHI',  'Multi-Door', '10.0-14.9', 0),
  ('Washer', 'HITACHI',  'Top Load',   '6-11',      0),
  ('SDA',    'HITACHI',  'OTH',        '<=5000',    0),
  ('SDA',    'HITACHI',  'OTH',        '>5000',     0),
  ('SDA',    'HITACHI',  'WH',         '>5000',     0),
  -- TVs
  ('AV',     'SONY',     '',           '55-64',     0),
  ('AV',     'ACONATIC', '',           '<=34',      0),
  ('AV',     'ACONATIC', '',           '40-44',     0),
  ('AV',     'ACONATIC', '',           '65-74',     0),
  -- Freezer showcase + air/water purifiers
  ('SDA',    'SANDEN',   'OTH',        '>5000',     0),
  ('SDA',    'MAZUMA',   'AIRP',       '>5000',     0),
  ('SDA',    'MAZUMA',   'OTH',        '>5000',     0)
ON CONFLICT (category_code, brand_code, design_token, size_token) DO NOTHING;
