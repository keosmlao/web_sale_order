-- Unit-count special rewards (workbook ④ "ຍອດຂາຍແອຕາມແບຮນດ໌" and
-- ⑤ "ຍອດຂາຍຕາມຮຸ່ນທີ່ກຳນົດ"): a per-UNIT spiff with two tiers, paid on each
-- person's OWN qualifying unit count for the month.
--
--   * brand_code set  → qualifying = the person's AIR-category sales of that
--     brand. A split-type air conditioner is TWO sale lines — the indoor coil
--     "… [C]" and the outdoor unit "… [H]" — so sets are counted from the
--     non-[H] lines only.
--   * item_match set  → qualifying = lines whose item_code equals it or whose
--     item_name contains it (model push, e.g. a specific TV). Same non-[H]
--     rule applies so an AC model never double-counts.
--
-- Tier rule: reach high_min_qty → EVERY unit pays high_reward; otherwise
-- reach low_min_qty → every unit pays low_reward; below low_min_qty → 0.
--
-- ⑥ "ບັນລຸເປົ້າຍອດຂາຍແອລວມພະແນກ" is the existing department-amount mechanism,
-- seeded here as a DEPT_AIR row in app_incentive_special_reward.

CREATE TABLE IF NOT EXISTS app_incentive_unit_reward (
  reward_code  varchar(30) PRIMARY KEY,
  description  text NOT NULL,
  group_code   varchar(20) NOT NULL DEFAULT 'AIR',
  brand_code   varchar(50),
  item_match   text,
  low_min_qty  numeric(10, 2) NOT NULL DEFAULT 1,
  low_reward   numeric(18, 4) NOT NULL DEFAULT 0,
  high_min_qty numeric(10, 2),
  high_reward  numeric(18, 4),
  is_active    boolean NOT NULL DEFAULT false
);

-- Workbook ④: MITSUBISHI air — ≥1 set pays 100/set, ≥10 sets pays 200/set.
-- Workbook ⑤: pushed model 110301-0716 — thresholds 10/20, amounts still 0
-- in the sheet (program parked until amounts are set).
INSERT INTO app_incentive_unit_reward
  (reward_code, description, group_code, brand_code, item_match,
   low_min_qty, low_reward, high_min_qty, high_reward, is_active) VALUES
  ('AIR_BRAND', 'ຍອດຂາຍແອຕາມແບຮນດ໌ທີ່ກຳນົດ', 'AIR', 'MITSUBISHI', NULL, 1, 100, 10, 200, false),
  ('AIR_MODEL', 'ຍອດຂາຍຮຸ່ນທີ່ກຳນົດ',        'AIR', NULL, '110301-0716', 10, 0, 20, 0, false)
ON CONFLICT (reward_code) DO NOTHING;

-- Workbook ⑥: AIR department monthly total (Retail CE+AIR+SDA sheet target).
-- Reward amount is 0 in the sheet — parked until set.
INSERT INTO app_incentive_special_reward
  (reward_code, description, group_code, brand_code, target_amount, reward_amount, split_by_share, is_active)
VALUES
  ('DEPT_AIR', 'ບັນລຸເປົ້າຍອດຂາຍແອລວມພະແນກ', 'AIR', NULL, 7222100, 0, false, false)
ON CONFLICT (reward_code) DO NOTHING;
