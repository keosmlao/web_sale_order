-- Point-based salesperson bonus model.
-- Mirrors workbook "com Retail by claude AI 2026-06-30" (sheets Bonus_Maps + Final_*).
-- Auto-generated from the workbook. Safe to re-run. Requires add-sales-incentive.sql first.

-- 1) Map SML item_category -> workbook bonus category (+ SDA subtype).
ALTER TABLE app_incentive_category
  ADD COLUMN IF NOT EXISTS pointmap_category varchar(10),
  ADD COLUMN IF NOT EXISTS sda_subtype varchar(10);

INSERT INTO app_incentive_category (category_code, category_name, group_code, pointmap_category, sda_subtype) VALUES
  ('008', 'ໂທລະທັດ', 'CE_SDA', 'AV', NULL),
  ('003', 'ເຄື່ອງສຽງ', 'CE_SDA', 'AV', NULL),
  ('004', 'ອຸປະກອນພາບແລະສຽງ', 'CE_SDA', 'AV', NULL),
  ('009', 'ຕູ້ເຢັນ', 'CE_SDA', 'REF', NULL),
  ('011', 'ເຄື່ອງຊັກ/ອົບຜ້າ', 'CE_SDA', 'Washer', NULL),
  ('032', 'ແອ', 'AIR', 'Air', NULL),
  ('012', 'ຕູ້ກົດນ້ຳ', 'CE_SDA', 'SDA', 'DISP'),
  ('017', 'ເຄື່ອງຟອກອາກາດ', 'CE_SDA', 'SDA', 'AIRP'),
  ('021', 'ເຄື່ອງເຮັດນ້ຳອຸ່ນ', 'CE_SDA', 'SDA', 'WH'),
  ('026', 'ເຕົາໄມໂຄເວັບ', 'CE_SDA', 'SDA', 'MW'),
  ('013', 'ພັດລົມ', 'CE_SDA', 'SDA', 'OTH'),
  ('014', 'ໝໍ້ຫຸງເຂົ້າ', 'CE_SDA', 'SDA', 'OTH'),
  ('015', 'ອຸປະກອນເຄື່ອງຄົວ', 'CE_SDA', 'SDA', 'OTH'),
  ('018', 'ເຄື່ອງດູດຝຸ່ນ', 'CE_SDA', 'SDA', 'OTH'),
  ('020', 'ເຄື່ອງເສີມຄວາມງາມ', 'CE_SDA', 'SDA', 'OTH'),
  ('022', 'ເຄື່ອງໃຊ້ໄຟຟ້າໃນຄົວ', 'CE_SDA', 'SDA', 'OTH'),
  ('023', 'ເຕົາລີດ', 'CE_SDA', 'SDA', 'OTH'),
  ('024', 'ເຕົາອົບໄຟຟ້າ', 'CE_SDA', 'SDA', 'OTH')
ON CONFLICT (category_code) DO UPDATE SET
  category_name = EXCLUDED.category_name, group_code = EXCLUDED.group_code,
  pointmap_category = EXCLUDED.pointmap_category, sda_subtype = EXCLUDED.sda_subtype;

-- 2) Bonus points per (category, brand, design, size).  X = base_amount (10 THB/point).
CREATE TABLE IF NOT EXISTS app_incentive_point_map (
  category_code varchar(10)  NOT NULL,
  brand_code    varchar(50)  NOT NULL,
  design_token  varchar(40)  NOT NULL DEFAULT '',
  size_token    varchar(40)  NOT NULL DEFAULT '',
  points        numeric(10,4) NOT NULL,
  PRIMARY KEY (category_code, brand_code, design_token, size_token)
);
INSERT INTO app_incentive_point_map (category_code, brand_code, design_token, size_token, points) VALUES
  ('REF', 'SHARP', 'Multi-Door', '>=20', 25.5),
  ('REF', 'HISENSE', 'Side-by-Side', '15.0-19.9', 17),
  ('REF', 'LG', 'Side-by-Side', '15.0-19.9', 17),
  ('REF', 'SAMSUNG', 'Side-by-Side', '15.0-19.9', 17),
  ('REF', 'HISENSE', 'Side-by-Side', '>=20', 17),
  ('REF', 'LG', 'Side-by-Side', '>=20', 17),
  ('REF', 'SAMSUNG', 'Side-by-Side', '>=20', 17),
  ('REF', 'HISENSE', 'Multi-Door', '>=20', 17),
  ('REF', 'HISENSE', '2 Door', '>=20', 10),
  ('REF', 'SAMSUNG', '2 Door', '>=20', 10),
  ('REF', 'SHARP', '2 Door', '10.0-14.9', 9),
  ('REF', 'HISENSE', '2 Door', '10.0-14.9', 6),
  ('REF', 'LG', '2 Door', '10.0-14.9', 6),
  ('REF', 'SAMSUNG', '2 Door', '10.0-14.9', 6),
  ('REF', 'LG', '2 Door', '15.0-19.9', 6),
  ('REF', 'SAMSUNG', '2 Door', '15.0-19.9', 6),
  ('REF', 'SHARP', '2 Door', '5.0-9.9', 6),
  ('REF', 'HISENSE', '2 Door', '5.0-9.9', 4),
  ('REF', 'LG', '2 Door', '5.0-9.9', 4),
  ('REF', 'SAMSUNG', '2 Door', '5.0-9.9', 4),
  ('REF', 'HISENSE', '1 Door', '5.0-9.9', 3),
  ('REF', 'HISENSE', '1 Door', '<5', 2),
  ('REF', 'HISENSE', 'Mini-Bar', '<5', 2),
  ('Washer', 'HISENSE', 'Dryer', '15-19', 18),
  ('Washer', 'HISENSE', 'Dryer', '>20', 18),
  ('Washer', 'LG', 'Dryer', '15-19', 15),
  ('Washer', 'SAMSUNG', 'Dryer', '15-19', 15),
  ('Washer', 'LG', 'Dryer', '>20', 15),
  ('Washer', 'SAMSUNG', 'Dryer', '>20', 15),
  ('Washer', 'HISENSE', 'Dryer', '12-14', 14.4),
  ('Washer', 'HISENSE', 'Dryer', '<5', 12),
  ('Washer', 'HISENSE', 'Dryer', '6-11', 12),
  ('Washer', 'LG', 'Dryer', '12-14', 12),
  ('Washer', 'SAMSUNG', 'Dryer', '12-14', 12),
  ('Washer', 'SAMSUNG', 'Front Load', '>20', 12),
  ('Washer', 'LG', 'Dryer', '<5', 10),
  ('Washer', 'SAMSUNG', 'Dryer', '<5', 10),
  ('Washer', 'LG', 'Dryer', '6-11', 10),
  ('Washer', 'SAMSUNG', 'Dryer', '6-11', 10),
  ('Washer', 'SAMSUNG', 'Front Load', '15-19', 12),
  ('Washer', 'HISENSE', 'Top Load', '>20', 9.6),
  ('Washer', 'HISENSE', 'Front Load', '6-11', 12),
  ('Washer', 'LG', 'Front Load', '12-14', 12),
  ('Washer', 'SAMSUNG', 'Front Load', '12-14', 12),
  ('Washer', 'LG', 'Top Load', '15-19', 8),
  ('Washer', 'SAMSUNG', 'Top Load', '15-19', 8),
  ('Washer', 'LG', 'Top Load', '>20', 8),
  ('Washer', 'SAMSUNG', 'Top Load', '>20', 8),
  ('Washer', 'LG', 'Front Load', '6-11', 10),
  ('Washer', 'SAMSUNG', 'Front Load', '6-11', 10),
  ('Washer', 'LG', 'Top Load', '12-14', 7),
  ('Washer', 'SAMSUNG', 'Top Load', '12-14', 7),
  ('Washer', 'LG', 'Top Load', '6-11', 3),
  ('Washer', 'SAMSUNG', 'Top Load', '6-11', 3),
  ('Washer', 'HISENSE', 'Twin Tub', '12-14', 2.4),
  ('Washer', 'LG', 'Twin Tub', '6-11', 2),
  ('Washer', 'LG', 'Twin Tub', '12-14', 2),
  ('Washer', 'SAMSUNG', 'Twin Tub', '12-14', 2),
  ('Washer', 'LG', 'Twin Tub', '15-19', 2),
  ('Washer', 'SAMSUNG', 'Twin Tub', '15-19', 2),
  ('AV', 'HISENSE', '', '<=34', 2.4),
  ('AV', 'HISENSE', '', '40-44', 6),
  ('AV', 'HISENSE', '', '55-64', 18),
  ('AV', 'HISENSE', '', '65-74', 24),
  ('AV', 'HISENSE', '', '>=75', 36),
  ('AV', 'LG', '', '<=34', 2),
  ('AV', 'LG', '', '40-44', 5),
  ('AV', 'LG', '', '55-64', 15),
  ('AV', 'LG', '', '65-74', 20),
  ('AV', 'LG', '', '>=75', 30),
  ('AV', 'SAMSUNG', '', '<=34', 2),
  ('AV', 'SAMSUNG', '', '40-44', 5),
  ('AV', 'SAMSUNG', '', '55-64', 15),
  ('AV', 'SAMSUNG', '', '65-74', 20),
  ('AV', 'SAMSUNG', '', '>=75', 30),
  ('AV', 'HISENSE', '', '<=10000', 10),
  ('AV', 'SAMSUNG', '', '<=10000', 10),
  ('AV', 'SAMSUNG', '', '10001-20000', 10),
  ('SDA', 'CAMEL', 'OTH', '<=2000', 0.5),
  ('SDA', 'CAMEL', 'OTH', '<=5000', 1.25),
  ('SDA', 'DAIKIN', 'OTH', '<=5000', 1.25),
  ('SDA', 'DAIKIN', 'OTH', '>5000', 1.5),
  ('SDA', 'MIDEA', 'OTH', '<=1000', 0.4),
  ('SDA', 'MIDEA', 'OTH', '<=2000', 0.8),
  ('SDA', 'MIDEA', 'OTH', '<=5000', 2),
  ('SDA', 'MIDEA', 'OTH', '>5000', 2.4),
  ('SDA', 'PANASONIC', 'OTH', '<=5000', 2),
  ('SDA', 'SHARP', 'OTH', '<=2000', 0.8),
  ('SDA', 'SHARP', 'OTH', '<=5000', 2),
  ('SDA', 'SHARP', 'OTH', '>5000', 2.4),
  ('SDA', 'SMART HOME', 'OTH', '<=1000', 0.25),
  ('SDA', 'SMART HOME', 'OTH', '<=2000', 0.5),
  ('SDA', 'TEFAL', 'OTH', '<=1000', 0.5),
  ('SDA', 'TEFAL', 'OTH', '<=5000', 2.5),
  ('SDA', 'AJ', 'OTH', '<=2000', 0.5),
  ('SDA', 'AJ', 'OTH', '>5000', 1.5),
  ('SDA', 'HANABISHI', 'OTH', '<=2000', 0.5),
  ('SDA', 'HANABISHI', 'OTH', '>5000', 1.5),
  ('SDA', 'HISENSE', 'OTH', '<=2000', 0.8),
  ('SDA', 'HISENSE', 'OTH', '>5000', 2.4),
  ('SDA', 'PHILIPS', 'OTH', '<=2000', 0.8),
  ('SDA', 'PHILIPS', 'OTH', '>5000', 2.4),
  ('SDA', 'SCI-MAX', 'OTH', '<=2000', 0.8),
  ('SDA', 'SCI-MAX', 'OTH', '>5000', 2.4),
  ('SDA', 'SURE VISION', 'OTH', '<=2000', 0.8),
  ('SDA', 'SURE VISION', 'OTH', '>5000', 2.4),
  ('SDA', 'MIDEA', 'WH', '<=1000', 0.9),
  ('SDA', 'MIDEA', 'WH', '<=2000', 2.25),
  ('SDA', 'MIDEA', 'WH', '<=5000', 3.6),
  ('SDA', 'PANASONIC', 'WH', '<=5000', 3.2),
  ('SDA', 'PANASONIC', 'WH', '>5000', 4),
  ('SDA', 'CENTON', 'WH', '<=2000', 2),
  ('SDA', 'CENTON', 'WH', '>5000', 4),
  ('SDA', 'SHARP', 'WH', '<=2000', 2),
  ('SDA', 'SHARP', 'WH', '>5000', 4),
  ('SDA', 'BEST COOL', 'DISP', '<=2000', 1.25),
  ('SDA', 'BEST COOL', 'DISP', '<=5000', 2),
  ('SDA', 'BEST COOL', 'DISP', '>5000', 2.5),
  ('SDA', 'MIDEA', 'DISP', '<=5000', 2),
  ('SDA', 'MIDEA', 'DISP', '>5000', 2.5),
  ('SDA', 'SHARP', 'DISP', '<=2000', 2),
  ('SDA', 'SHARP', 'DISP', '>5000', 4),
  ('SDA', 'DAIKIN', 'AIRP', '<=5000', 1.5),
  ('SDA', 'DAIKIN', 'AIRP', '>5000', 2),
  ('SDA', 'SAMSUNG', 'AIRP', '<=5000', 2.4),
  ('SDA', 'SAMSUNG', 'AIRP', '>5000', 3.2),
  ('SDA', 'SMART HOME', 'AIRP', '>5000', 3.2),
  ('SDA', 'MIDEA', 'MW', '<=2000', 1.25),
  ('SDA', 'MIDEA', 'MW', '<=5000', 1.25),
  ('SDA', 'PANASONIC', 'MW', '<=2000', 1.25),
  ('SDA', 'PANASONIC', 'MW', '<=5000', 1.25),
  ('SDA', 'SAMSUNG', 'MW', '<=5000', 1.25),
  ('SDA', 'SAMSUNG', 'MW', '>5000', 2.5),
  ('SDA', 'SHARP', 'MW', '<=2000', 1.25),
  ('SDA', 'SHARP', 'MW', '>5000', 2.5),
  ('Air', 'AUX', 'Inverter', '<=10000', 7),
  ('Air', 'CARRIER', 'Inverter', '<=10000', 7),
  ('Air', 'CARRIER', 'On-Off', '<=10000', 5.6),
  ('Air', 'DAIKIN', 'Inverter', '<=10000', 8.4),
  ('Air', 'DAIKIN', 'Inverter', '10001-20000', 9.24),
  ('Air', 'DAIKIN', 'Inverter', '>20000', 10.92),
  ('Air', 'DAIKIN', 'On-Off', '<=10000', 6.72),
  ('Air', 'HISENSE', 'Inverter', '<=10000', 9.8),
  ('Air', 'HISENSE', 'Inverter', '10001-20000', 10.78),
  ('Air', 'HISENSE', 'Inverter', '>20000', 12.74),
  ('Air', 'HISENSE', 'On-Off', '<=10000', 7.84),
  ('Air', 'LG', 'Inverter', '<=10000', 7),
  ('Air', 'LG', 'Inverter', '10001-20000', 7.7),
  ('Air', 'MIDEA', 'Inverter', '<=10000', 7),
  ('Air', 'MIDEA', 'On-Off', '<=10000', 5.6),
  ('Air', 'MIDEA', 'On-Off', '10001-20000', 5.6),
  ('Air', 'PANASONIC', 'Inverter', '<=10000', 10.5),
  ('Air', 'PANASONIC', 'Inverter', '10001-20000', 11.55),
  ('Air', 'PANASONIC', 'On-Off', '<=10000', 8.4),
  ('Air', 'SAMSUNG', 'Inverter', '<=10000', 7),
  ('Air', 'SAMSUNG', 'Inverter', '10001-20000', 7.7),
  ('Air', 'SAMSUNG', 'On-Off', '<=10000', 5.6),
  ('Air', 'SAMSUNG', 'On-Off', '10001-20000', 5.6),
  ('Air', 'SHARP', 'Inverter', '<=10000', 7),
  ('Air', 'TOSHIBA', 'Inverter', '<=10000', 7),
  ('Air', 'TOSHIBA', 'On-Off', '<=10000', 5.6)
ON CONFLICT (category_code, brand_code, design_token, size_token) DO UPDATE SET points = EXCLUDED.points;

-- 3) Translate SML ic_design.name_1 -> design token (REF doors, Washer loads).
CREATE TABLE IF NOT EXISTS app_incentive_design_token (
  design_name varchar(80) PRIMARY KEY, design_token varchar(40) NOT NULL);
INSERT INTO app_incentive_design_token (design_name, design_token) VALUES
  ('2 ປະຕູ', '2 Door'),
  ('1 ປະຕູ', '1 Door'),
  ('ມິນິບາຣ໌', 'Mini-Bar'),
  ('ຫຼາຍປະຕູ', 'Multi-Door'),
  ('ໄຊ້ບາຍໄຊ້', 'Side-by-Side'),
  ('ຝາເທິງ', 'Top Load'),
  ('ຝາໜ້າ', 'Front Load'),
  ('ສອງຖັງ', 'Twin Tub')
ON CONFLICT (design_name) DO UPDATE SET design_token = EXCLUDED.design_token;

-- 4) Translate SML ic_size.name_1 -> size band token (cuft / kg / inch).
CREATE TABLE IF NOT EXISTS app_incentive_size_token (
  size_name varchar(80) PRIMARY KEY, size_token varchar(40) NOT NULL);
INSERT INTO app_incentive_size_token (size_name, size_token) VALUES
  ('ນ້ອຍກວ່າ 5.0ຄິວ', '<5'),
  ('5.0-9.9ຄິວ', '5.0-9.9'),
  ('10.0-14.9ຄິວ', '10.0-14.9'),
  ('15.0-19.9ຄິວ', '15.0-19.9'),
  ('20.0ຄິວ ຂື້ນໄປ', '>=20'),
  ('7.5ກິໂລ', '6-11'),
  ('8.0ກິໂລ', '6-11'),
  ('9.0ກິໂລ', '6-11'),
  ('10.5ກິໂລ', '6-11'),
  ('12.0ກິໂລ', '12-14'),
  ('13.0ກິໂລ', '12-14'),
  ('14.0ກິໂລ', '12-14'),
  ('15.0ກິໂລ', '15-19'),
  ('16.0ກິໂລ', '15-19'),
  ('17.0ກິໂລ', '15-19'),
  ('18.0ກິໂລ', '15-19'),
  ('19.0ກິໂລ', '15-19'),
  ('19.0KG', '15-19'),
  ('20.0ກິໂລ', '>20'),
  ('21.0ກິໂລ', '>20'),
  ('22.0ກິໂລ', '>20'),
  ('25.0ກິໂລ', '>20'),
  ('31ນີ້ວ-34ນີ້ວ', '<=34'),
  ('40ນີ້ວ-44ນີ້ວ', '40-44'),
  ('55ນິ້ວ-59ນິ້ວ', '55-64'),
  ('65ນິ້ວ-69ນິ້ວ', '65-74'),
  ('70ນິ້ວ-74ນິ້ວ', '65-74'),
  ('75ນິ້ວ-79ນິ້ວ', '>=75'),
  ('80 ນິ້ວຂື້ນໄປ', '>=75')
ON CONFLICT (size_name) DO UPDATE SET size_token = EXCLUDED.size_token;

-- 5) Product-status multipliers (workbook: current=1, promoMax=1.2, promoMin=0.5, noBonus=0).
CREATE TABLE IF NOT EXISTS app_incentive_status_multiplier (
  status_code varchar(40) PRIMARY KEY, multiplier numeric(8,4) NOT NULL);
INSERT INTO app_incentive_status_multiplier (status_code, multiplier) VALUES
  ('current', 1), ('special_promo_max', 1.2), ('special_min_bonus', 0.5), ('special_no_bonus', 0)
ON CONFLICT (status_code) DO UPDATE SET multiplier = EXCLUDED.multiplier;

-- 6) Special department rewards (workbook: HISENSE brand + CE+SDA department).
CREATE TABLE IF NOT EXISTS app_incentive_special_reward (
  reward_code   varchar(30) PRIMARY KEY,
  description   text NOT NULL,
  group_code    varchar(20) NOT NULL,
  brand_code    varchar(50),
  target_amount numeric(18,4) NOT NULL,
  reward_amount numeric(18,4) NOT NULL,
  split_by_share boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT false);
-- is_active defaults FALSE: the workbook's June sheet shows 0 special pay for everyone even
-- though a department target was met, so the exact trigger logic is not yet business-confirmed.
-- Enable per reward once verified (Settings, or UPDATE ... SET is_active = true).
ALTER TABLE app_incentive_special_reward ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;
INSERT INTO app_incentive_special_reward (reward_code, description, group_code, brand_code, target_amount, reward_amount, split_by_share, is_active) VALUES
  ('HISENSE_CE', 'ບັນລຸເປົ້າ CE ຍີ່ຫໍ້ HISENSE', 'CE_SDA', 'HISENSE', 1000000, 5000, true, false),
  ('DEPT_CE_SDA', 'ບັນລຸເປົ້າ CE+SDA ລວມພະແນກ', 'CE_SDA', NULL, 10012100, 1000, false, false)
ON CONFLICT (reward_code) DO UPDATE SET target_amount = EXCLUDED.target_amount,
  reward_amount = EXCLUDED.reward_amount, split_by_share = EXCLUDED.split_by_share;

-- 7) Config corrections to match this workbook.
UPDATE app_incentive_config
SET base_amount = 10,        -- X: 10 THB per bonus point
    low_max_pct = 0.50       -- performance tier boundary: 1-50% -> low
WHERE id = 1;

-- 8) No-bonus item overrides from workbook Bonus_Maps (column W).
--    First drop the stale rows seeded by add-sales-incentive.sql from the earlier "spec"
--    workbook (e.g. 110101-0929 was special_min_bonus there but is a normal-bonus item in
--    this workbook). Keeping them would under-pay those items.
DELETE FROM app_incentive_product_status WHERE note = 'Imported from workbook Product_Status';
INSERT INTO app_incentive_product_status (item_code, status_code, weight, note) VALUES
  ('110101-0266', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110101-0285', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110101-1046', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110101-1116', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110101-1130', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0421', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0467', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0683', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0689', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0690', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0696', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0713', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0721', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0722', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0728', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0731', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0736', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0742', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0749', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0756', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0757', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0758', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0759', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0761', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0764', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0773', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110301-0775', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list'),
  ('110302-0347', 'special_no_bonus', 0, 'workbook 2026-06-30 no-bonus list')
ON CONFLICT (item_code) DO UPDATE SET status_code = EXCLUDED.status_code,
  weight = EXCLUDED.weight, note = EXCLUDED.note, updated_at = now();


-- 9) Salesperson name aliases: odg_sale_detail.salename (free-text from SML) can differ
--    from odg_employee.fullname_lo spelling. Map the known variants so performance targets
--    resolve. Add rows here whenever a walk-in salename fails to match a roster name.
CREATE TABLE IF NOT EXISTS app_incentive_sale_alias (
  salename      varchar(120) PRIMARY KEY,
  employee_code varchar(20) NOT NULL
);
INSERT INTO app_incentive_sale_alias (salename, employee_code) VALUES
  ('ບຸນມີໄຊ ກຽດທອງຄຳ', '24037'),   -- roster: ບຸນມີໄຊ ເລືອງທອງຄຳ
  ('ອຸດົມຊັບ ວິລະວັງ', '22027'),    -- roster: ອຸດົມຊັບ ວິລະວົງ
  ('ພາສຸກ ຫຼວງລາດ', '26010')        -- target code 26010 has no odg_employee record
ON CONFLICT (salename) DO UPDATE SET employee_code = EXCLUDED.employee_code;
