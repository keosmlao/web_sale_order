import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

console.log('--- Expected aggregates for 2026-05-06 with the new filter ---');
const r = await c.query(`
  SELECT
    COUNT(*) AS docs,
    SUM(total_amount)::numeric(20,2) AS total_baht,
    COUNT(*) FILTER (WHERE department_code = '2042') AS spare_should_be_zero
  FROM ic_trans
  WHERE trans_flag = 44
    AND (doc_no LIKE 'CAK%' OR doc_no LIKE 'INK%')
    AND to_char(doc_date,'yyyy') = '2026'
    AND doc_date = '2026-05-06'
    AND department_code IN ('2012','2022','2032','2062')
`);
console.log(JSON.stringify(r.rows, null, 2));

console.log('\n--- BEFORE filter (all depts) on 2026-05-06 for comparison ---');
const before = await c.query(`
  SELECT
    COUNT(*) AS docs,
    SUM(total_amount)::numeric(20,2) AS total_baht
  FROM ic_trans
  WHERE trans_flag = 44
    AND (doc_no LIKE 'CAK%' OR doc_no LIKE 'INK%')
    AND to_char(doc_date,'yyyy') = '2026'
    AND doc_date = '2026-05-06'
`);
console.log(JSON.stringify(before.rows, null, 2));

await c.end();
