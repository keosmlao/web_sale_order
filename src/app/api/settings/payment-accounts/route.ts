import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import {
  ACCEPTED_CURRENCIES,
  CURRENCY_LABEL,
  type CurrencyCode,
  type PayMethod,
} from "@/lib/payment";
import {
  DEFAULT_PAYMENT_ACCOUNTS,
  getSelectableAccounts,
} from "@/lib/payment-accounts";

// The four (currency, method) slots a cashier can settle into. Order drives
// the settings grid.
const SLOTS: Array<{ currencyCode: CurrencyCode; payMethod: PayMethod }> = [];
for (const currencyCode of ACCEPTED_CURRENCIES) {
  for (const payMethod of ["cash", "transfer"] as const) {
    SLOTS.push({ currencyCode, payMethod });
  }
}

const METHOD_LABEL: Record<PayMethod, string> = {
  cash: "ເງິນສົດ",
  transfer: "ເງິນໂອນ",
};

function canManage(
  employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>,
) {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
}

type ConfiguredRow = {
  currency_code: string | null;
  pay_method: string | null;
  account_code: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [configured, accounts] = await Promise.all([
    prisma.$queryRaw<ConfiguredRow[]>`
      SELECT currency_code, pay_method, account_code
      FROM app_payment_account
    `.catch(() => [] as ConfiguredRow[]),
    getSelectableAccounts(),
  ]);

  const byKey = new Map<string, string>();
  for (const r of configured) {
    const c = r.currency_code?.trim();
    const m = r.pay_method?.trim();
    const a = r.account_code?.trim();
    if (c && m && a) byKey.set(`${c}:${m}`, a);
  }

  return NextResponse.json({
    canManage: canManage(employee),
    accounts,
    slots: SLOTS.map((s) => {
      const k = `${s.currencyCode}:${s.payMethod}`;
      return {
        currencyCode: s.currencyCode,
        payMethod: s.payMethod,
        label: `${CURRENCY_LABEL[s.currencyCode].name} · ${METHOD_LABEL[s.payMethod]}`,
        accountCode:
          byKey.get(k) ??
          DEFAULT_PAYMENT_ACCOUNTS[k as keyof typeof DEFAULT_PAYMENT_ACCOUNTS],
      };
    }),
  });
}

type PutEntry = { currencyCode: string; payMethod: string; accountCode: string };

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(employee)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດແກ້ໄຂການຕັ້ງຄ່າບັນຊີຮັບເງິນ" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { entries?: unknown }
    | null;
  const rawEntries = Array.isArray(body?.entries) ? body!.entries : [];

  // Only accept the known slots, with a non-empty account code.
  const validSlot = new Set(SLOTS.map((s) => `${s.currencyCode}:${s.payMethod}`));
  const entries: PutEntry[] = [];
  for (const raw of rawEntries as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const currencyCode = typeof r.currencyCode === "string" ? r.currencyCode.trim() : "";
    const payMethod = typeof r.payMethod === "string" ? r.payMethod.trim() : "";
    const accountCode = typeof r.accountCode === "string" ? r.accountCode.trim() : "";
    if (!validSlot.has(`${currencyCode}:${payMethod}`) || !accountCode) continue;
    entries.push({ currencyCode, payMethod, accountCode });
  }

  const updatedBy = employee.employeeCode ?? null;
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.$executeRaw`
        INSERT INTO app_payment_account (
          currency_code, pay_method, account_code, updated_by, updated_at
        )
        VALUES (${e.currencyCode}, ${e.payMethod}, ${e.accountCode}, ${updatedBy}, now())
        ON CONFLICT (currency_code, pay_method)
        DO UPDATE SET
          account_code = EXCLUDED.account_code,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
    }
  });

  return GET(request);
}
