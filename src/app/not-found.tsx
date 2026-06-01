import Link from "next/link";

export default function NotFound() {
 return (
 <main className="flex min-h-screen items-center justify-center bg-odoo-surface-muted px-4 py-10 text-odoo-text-strong">
 <section className="odoo-card w-full max-w-md p-6 text-center">
 <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-odoo-primary text-lg font-bold text-white">
 S
 </div>
 <h1 className="mt-5 text-2xl font-bold">ບໍ່ພົບໜ້ານີ້</h1>
 <p className="mt-2 text-sm leading-6 text-odoo-text">
 ໜ້າທີ່ທ່ານເປີດອາດຖືກຍ້າຍ, ຖືກລົບ ຫຼື ລິ້ງບໍ່ຖືກຕ້ອງ.
 </p>
 <Link
 href="/"
 className="odoo-btn odoo-btn-primary mt-5 justify-center"
 >
 ກັບໄປໜ້າຫຼັກ
 </Link>
 </section>
 </main>
 );
}
