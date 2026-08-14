import "dotenv/config";
import pg from "pg";

const expectedPoints = new Map([
  ["AUX|Inverter|<=10000", 7],
  ["CARRIER|Inverter|<=10000", 7], ["CARRIER|On-Off|<=10000", 5.5],
  ["DAIKIN|Inverter|<=10000", 8.5], ["DAIKIN|Inverter|10001-20000", 9],
  ["DAIKIN|Inverter|>20000", 11], ["DAIKIN|On-Off|<=10000", 6.5],
  ["HISENSE|Inverter|<=10000", 10], ["HISENSE|Inverter|10001-20000", 11],
  ["HISENSE|Inverter|>20000", 12.5], ["HISENSE|On-Off|<=10000", 8],
  ["LG|Inverter|<=10000", 7], ["LG|Inverter|10001-20000", 7.5],
  ["MIDEA|Inverter|<=10000", 7], ["MIDEA|On-Off|<=10000", 5.5],
  ["MIDEA|On-Off|10001-20000", 5.5],
  ["PANASONIC|Inverter|<=10000", 10.5], ["PANASONIC|Inverter|10001-20000", 11.5],
  ["PANASONIC|On-Off|<=10000", 8.5],
  ["SAMSUNG|Inverter|<=10000", 7], ["SAMSUNG|Inverter|10001-20000", 7.5],
  ["SAMSUNG|On-Off|<=10000", 5.5], ["SAMSUNG|On-Off|10001-20000", 5.5],
  ["SHARP|Inverter|<=10000", 7],
  ["TOSHIBA|Inverter|<=10000", 7], ["TOSHIBA|On-Off|<=10000", 5.5],
]);

const expectedCeSdaPoints = new Map([
  ["REF|LG|1 Door|5.0-9.9", 3],
  ["REF|SAMSUNG|1 Door|5.0-9.9", 3],
  ["REF|HISENSE|1 Door|5.0-9.9", 0],
  ["SDA|HATARI|OTH|<=2000", 0.5],
  ["SDA|HATARI|OTH|<=5000", 1.25],
  ["SDA|HATARI|OTH|>5000", 1.5],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 30_000,
});

try {
  const points = await pool.query(`
    SELECT brand_code, design_token, size_token, points
    FROM app_incentive_point_rule
    WHERE category_code = 'Air'
      AND effective_from = DATE '2026-07-01'
      AND effective_to = DATE '2026-07-31'
  `);
  assert(points.rowCount === expectedPoints.size, `Expected 26 July AIR rules, found ${points.rowCount}`);
  for (const row of points.rows) {
    const key = `${row.brand_code}|${row.design_token}|${row.size_token}`;
    assert(expectedPoints.has(key), `Unexpected July AIR rule: ${key}`);
    assert(Number(row.points) === expectedPoints.get(key), `Wrong points for ${key}: ${row.points}`);
  }

  const ceSda = await pool.query(`
    SELECT category_code, brand_code, design_token, size_token, points
    FROM app_incentive_point_rule
    WHERE category_code IN ('REF', 'SDA')
      AND effective_from = DATE '2026-07-01'
      AND effective_to = DATE '2026-07-31'
  `);
  assert(ceSda.rowCount === expectedCeSdaPoints.size, `Expected 6 July CE/SDA overrides, found ${ceSda.rowCount}`);
  for (const row of ceSda.rows) {
    const key = `${row.category_code}|${row.brand_code}|${row.design_token}|${row.size_token}`;
    assert(expectedCeSdaPoints.has(key), `Unexpected July CE/SDA rule: ${key}`);
    assert(Number(row.points) === expectedCeSdaPoints.get(key), `Wrong points for ${key}: ${row.points}`);
  }

  const statuses = await pool.query(`
    SELECT status_code, COUNT(*)::int AS items
    FROM app_incentive_product_status_rule
    WHERE effective_from = DATE '2026-07-01'
      AND effective_to = DATE '2026-07-31'
    GROUP BY status_code
  `);
  const statusCounts = new Map(statuses.rows.map((row) => [row.status_code, row.items]));
  assert(statusCounts.get("special_no_bonus") === 38, "Expected 38 July no-bonus items");
  assert(statusCounts.get("special_min_bonus") === 12, "Expected 12 July minimum-bonus items");
  assert(statusCounts.get("special_promo_max") === 3, "Expected 3 July maximum-bonus items");

  const rewards = await pool.query(`
    SELECT reward_code, group_code, target_amount, reward_amount,
           effective_from::text, effective_to::text
    FROM app_incentive_special_reward
    WHERE reward_code = 'DEPT_ALL_202607'
  `);
  const department = rewards.rows[0];
  assert(department?.group_code === "ALL", "July department reward must use ALL scope");
  assert(Number(department?.target_amount) === 11_733_200, "Wrong July department target");
  assert(Number(department?.reward_amount) === 1_000, "Wrong July department reward");
  assert(department?.effective_from === "2026-07-01" && department?.effective_to === "2026-07-31", "Wrong department reward dates");

  const units = await pool.query(`
    SELECT reward_code, group_code, brand_code, item_match,
           low_min_qty, low_reward, high_min_qty, high_reward,
           effective_from::text, effective_to::text
    FROM app_incentive_unit_reward
    WHERE reward_code IN ('AIR_BRAND', 'AIR_MODEL')
    ORDER BY reward_code
  `);
  const brand = units.rows.find((row) => row.reward_code === "AIR_BRAND");
  const model = units.rows.find((row) => row.reward_code === "AIR_MODEL");
  assert(brand?.group_code === "AIR" && brand?.brand_code === "MITSUBISHI", "Wrong Mitsubishi scope");
  assert(Number(brand?.low_min_qty) === 1 && Number(brand?.low_reward) === 100, "Wrong Mitsubishi low tier");
  assert(Number(brand?.high_min_qty) === 10 && Number(brand?.high_reward) === 200, "Wrong Mitsubishi high tier");
  assert(model?.group_code === "CE_SDA" && model?.item_match === "110301-0716", "TV model reward must use CE_SDA");
  assert(units.rows.every((row) => row.effective_from === "2026-07-01" && row.effective_to === "2026-07-31"), "Wrong unit-reward dates");

  const combo = await pool.query(`
    WITH air AS (
      SELECT sd.doc_no, sd.qty, sd.price, sd.item_name,
             CASE
               WHEN sd.item_name ~ '\\[[CH]\\]\\s*$'
                 AND EXISTS (
                   SELECT 1
                   FROM odg_sale_detail pair
                   WHERE pair.doc_no = sd.doc_no
                     AND pair.branch_code IS NOT DISTINCT FROM sd.branch_code
                     AND pair.salename IS NOT DISTINCT FROM sd.salename
                     AND UPPER(COALESCE(pair.item_brand, '')) = UPPER(COALESCE(sd.item_brand, ''))
                     AND pair.qty IS NOT DISTINCT FROM sd.qty
                     AND pair.price IS NOT DISTINCT FROM sd.price
                     AND (
                       (sd.item_name ~ '\\[C\\]\\s*$' AND pair.item_name ~ '\\[H\\]\\s*$')
                       OR
                       (sd.item_name ~ '\\[H\\]\\s*$' AND pair.item_name ~ '\\[C\\]\\s*$')
                     )
                 )
                 THEN sd.price * 2
               ELSE sd.price
             END AS band_price
      FROM odg_sale_detail sd
      LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
      WHERE sd.branch_code = '01'
        AND sd.argroup_main = '101'
        AND sd.doc_date >= DATE '2026-07-01'
        AND sd.doc_date < DATE '2026-08-01'
        AND cat.pointmap_category = 'Air'
    )
    SELECT SUM(qty) AS line_qty,
           SUM(CASE WHEN item_name ~ '\\[H\\]\\s*$' THEN 0 ELSE qty END) AS set_qty,
           MAX(band_price / NULLIF(price, 0)) AS max_component_multiplier,
           MAX(band_price) FILTER (WHERE doc_no = 'CAK26009303') AS repeated_set_price
    FROM air
  `);
  const shape = combo.rows[0];
  assert(Number(shape?.set_qty) <= Number(shape?.line_qty), "AIR set count cannot exceed component-line quantity");
  assert(Number(shape?.max_component_multiplier) <= 2, "AIR price band must use at most one C/H pair");
  assert(Number(shape?.repeated_set_price) === 14_510.412, "Repeated MIDEA sets must keep their per-set price band");

  console.log(JSON.stringify({
    julyAirRules: points.rowCount,
    julyCeSdaOverrides: ceSda.rowCount,
    julyProductStatuses: 53,
    departmentReward: `${department.target_amount} / ${department.reward_amount}`,
    airComponentQty: Number(shape.line_qty),
    airSetQty: Number(shape.set_qty),
    repeatedAirSetPrice: Number(shape.repeated_set_price),
    status: "ok",
  }, null, 2));
} finally {
  await pool.end();
}
