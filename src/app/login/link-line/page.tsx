import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPayload } from "@/lib/line";
import LinkLineForm from "./LinkLineForm";

export const dynamic = "force-dynamic";

type PendingLink = { lineUserId: string; displayName: string };

// Shown once, right after the first LINE sign-in: confirm who this LINE
// account belongs to by entering the normal employee credentials.
export default async function LinkLinePage() {
  const jar = await cookies();
  const pending = verifyPayload<PendingLink>(jar.get("line_link_pending")?.value);
  if (!pending?.lineUserId) redirect("/login");

  return (
    <div className="login-shell">
      <main className="login-panel" style={{ width: "100%" }}>
        <div className="login-panel-inner">
          <div className="login-mobile-brand">
            <div className="login-brand-logo"><img src="/odm.png" alt="ODIEN Mall" /></div>
            <div>
              <div className="login-brand-name">ODG ຂາຍ</div>
              <div className="login-brand-tag">Sales Management</div>
            </div>
          </div>

          <div className="login-form-head">
            <h2>ເຊື່ອມບັນຊີ LINE</h2>
            <p>
              LINE: <strong>{pending.displayName || "ບັນຊີ LINE"}</strong> ·
              ຢືນຢັນຕົວຕົນຄັ້ງດຽວ ດ້ວຍລະຫັດພະນັກງານ — ຄັ້ງຕໍ່ໄປກົດ LINE ເຂົ້າໄດ້ເລີຍ
            </p>
          </div>

          <LinkLineForm />

          <div className="login-foot-help">
            ມີບັນຫາ? ຕິດຕໍ່ <strong>ຝ່າຍ IT</strong>
          </div>
        </div>
      </main>
    </div>
  );
}
