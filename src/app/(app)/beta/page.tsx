import { APP_BETA, APP_RELEASE } from "@/lib/app-release";

// The install page for the beta channel.
//
// Betas are installed by hand — Android has no store to push them from —
// so this exists to make that one tap on a tablet instead of a URL
// someone has to type without mistakes.

export const dynamic = "force-dynamic";

export default function BetaPage() {
  const ahead = APP_BETA.isAhead;

  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-10">
      <div className="mb-8">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-odoo-primary">
          ຊ່ອງທົດລອງ
        </div>
        <h1 className="mt-2 text-[26px] font-black leading-tight text-odoo-text-strong">
          ລອງກ່ອນຮ້ານ
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-odoo-text-muted">
          ວຽກໃໝ່ລົງທີ່ນີ້ກ່ອນ. ຕິດຕັ້ງໃສ່ເຄື່ອງດຽວ ລອງອອກບິນ ແລ້ວຄ່ອຍ
          ບອກໃຫ້ຍ້າຍໄປລຸ້ນຈິງ — ຮ້ານຈະບໍ່ຖືກບັງຄັບອັບເດດລະຫວ່າງມື້.
        </p>
      </div>

      <section className="rounded-2xl border border-odoo-border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
              ລຸ້ນທົດລອງ
            </div>
            <div className="mt-1 font-mono text-[22px] font-black text-odoo-text-strong">
              {APP_BETA.version}
              <span className="text-odoo-text-muted">+{APP_BETA.buildNumber}</span>
            </div>
          </div>
          <span
            className={
              "shrink-0 rounded-full px-3 py-1 text-[11px] font-black " +
              (ahead
                ? "bg-emerald-50 text-emerald-700"
                : "bg-odoo-surface-muted text-odoo-text-muted")
            }
          >
            {ahead ? "ມີຂອງໃໝ່" : "ຄືລຸ້ນຈິງ"}
          </span>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-odoo-text">
          {APP_BETA.notes}
        </p>

        <a
          href={APP_BETA.downloadUrl}
          className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-odoo-primary text-[15px] font-black text-white transition hover:brightness-110"
        >
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3v12" />
            <path d="m7 11 5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
          ຕິດຕັ້ງລຸ້ນທົດລອງ
        </a>

        <p className="mt-3 text-[12px] leading-relaxed text-odoo-text-muted">
          ຕິດຕັ້ງທັບໄດ້ເລີຍ ບໍ່ຕ້ອງຖອນອັນເກົ່າ. ຂໍ້ມູນທີ່ຄ້າງໄວ້ຍັງຢູ່.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-odoo-border bg-odoo-surface-muted p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
          ລຸ້ນຈິງ ທີ່ຮ້ານໃຊ້ຢູ່
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="font-mono text-[17px] font-black text-odoo-text-strong">
            {APP_RELEASE.version}
            <span className="text-odoo-text-muted">+{APP_RELEASE.buildNumber}</span>
          </span>
          <span className="text-[12px] text-odoo-text-muted">ບັງຄັບອັບເດດ</span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-odoo-text-muted">
          {APP_RELEASE.notes}
        </p>
        <a
          href={APP_RELEASE.downloadUrl}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-odoo-border bg-white px-4 py-2 text-[13px] font-bold text-odoo-text-strong transition hover:border-odoo-primary"
        >
          ກັບໄປລຸ້ນຈິງ
        </a>
      </section>

      <p className="mt-6 text-[12px] leading-relaxed text-odoo-text-muted">
        ລຸ້ນທົດລອງບໍ່ບັງຄັບອັບເດດໃຜ. ຖ້າລຸ້ນຈິງແຊງໜ້າມັນ ເຄື່ອງທີ່ລົງ
        ທົດລອງໄວ້ຈະຖືກດຶງໄປລຸ້ນຈິງເອງ ຄືກັບລຸ້ນເກົ່າອື່ນໆ.
      </p>
    </div>
  );
}
