// The incentive CONFIGURATION UI has moved to the Product Management app
// (src/app/(app)/settings/incentives there). This notice replaces the old
// editor so existing links do not 404. The /api/incentives/* routes in this app
// are intentionally kept — reports may still read them.
export const metadata = { title: "Incentive ຍ້າຍໄປ Product Management ແລ້ວ" };

export default function IncentiveConfigMovedPage() {
  return (
    <main className="odoo-page">
      <div
        className="odoo-card"
        style={{ maxWidth: "640px", margin: "48px auto", padding: "28px 30px" }}
      >
        <h1 className="odoo-page-title">ການຕັ້ງຄ່າ Incentive ຍ້າຍໄປແລ້ວ</h1>
        <p className="odoo-page-subtitle" style={{ marginTop: "12px", lineHeight: 1.75 }}>
          ໜ້າຕັ້ງຄ່າ Incentive (ສູດ, ເປົ້າຂາຍ, ຄ່າຄອມ, ລາງວັນ ແລະ Point Map)
          ໄດ້ຍ້າຍໄປຢູ່ລະບົບ <strong>Product Management</strong> ແລ້ວ.
        </p>
        <p className="odoo-page-subtitle" style={{ marginTop: "10px", lineHeight: 1.75 }}>
          ກະລຸນາເປີດ Product Management ແລ້ວໄປທີ່ ເມນູ{" "}
          <strong>ບໍລິຫານ › ຕັ້ງຄ່າ Incentive</strong> (<code>/settings/incentives</code>).
        </p>
      </div>
    </main>
  );
}
