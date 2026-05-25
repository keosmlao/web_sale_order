"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
 createEmployeeAction,
 deleteEmployeeAction,
 setRoleAction,
 updateEmployeeAction,
 type ActionResult,
} from "./actions";
import type { AppRole } from "@/lib/roles";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export type Employee = {
 employeeCode: string;
 titleLo: string | null;
 fullnameLo: string | null;
 nickname: string | null;
 titleEn: string | null;
 fullnameEn: string | null;
 positionCode: string | null;
 divisionCode: string | null;
 departmentCode: string | null;
 unitCode: string | null;
 hireDate: string | null;
 employmentStatus: string | null;
 lineId: string | null;
 // Effective role (derived from position_code unless an override is set).
 appRole: AppRole;
 // Raw app_role column value — null when the role is auto-derived.
 roleOverride: string | null;
 hasPassword: boolean;
};

export type Dept = { code: string; name: string };

export type AvailableEmployee = {
 code: string;
 fullnameLo: string | null;
 fullnameEn: string | null;
 nickname: string | null;
 departmentCode: string | null;
 positionCode: string | null;
};

const numFmt = new Intl.NumberFormat("en-US");

const STATUS_LABELS: Record<string, string> = {
 ACTIVE:"ໃຊ້ງານ",
 INACTIVE:"ປິດໃຊ້ງານ",
};

const ROLE_LABELS: Record<AppRole, string> = {
 pc:"PC",
 salesperson:"ພະນັກງານຂາຍ",
 head:"ຫົວໜ້າພະນັກງານຂາຍ",
 manager:"ຜູ່ຈັດການ",
};

const ROLE_OPTIONS: AppRole[] = ["pc","salesperson","head","manager"];

type Props = {
 employees: Employee[];
 depts: ReadonlyArray<Dept>;
 availableEmployees: ReadonlyArray<AvailableEmployee>;
 total: number;
 activeCount: number;
 inactiveCount: number;
 page: number;
 pageSize: number;
 query: string;
 dept: string;
 status: string;
 currentEmployeeCode: string;
 currentUserRole: AppRole;
};

export default function EmployeesClient({
 employees,
 depts,
 availableEmployees,
 total,
 activeCount,
 inactiveCount,
 page,
 pageSize,
 query,
 dept,
 status,
 currentEmployeeCode,
 currentUserRole,
}: Props) {
 const canAssignRoles =
 currentUserRole ==="head" || currentUserRole ==="manager";
 const router = useRouter();
 const pathname = usePathname();
 const [isPending, startTransition] = useTransition();

 const [searchInput, setSearchInput] = useState(query);
 const [editing, setEditing] = useState<Employee | null>(null);
 const [adding, setAdding] = useState(false);

 useEffect(() => {
 if (searchInput === query) return;
 const t = setTimeout(() => {
 pushParams({ q: searchInput || null, page:"1" });
 }, 300);
 return () => clearTimeout(t);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [searchInput]);

 function pushParams(patch: Record<string, string | null>) {
 const params = new URLSearchParams();
 if (query) params.set("q", query);
 if (dept) params.set("dept", dept);
 if (status) params.set("status", status);
 if (page > 1) params.set("page", String(page));
 if (pageSize !== 50) params.set("pageSize", String(pageSize));
 for (const [k, v] of Object.entries(patch)) {
 if (v === null || v ==="") params.delete(k);
 else params.set(k, v);
 }
 const search = params.toString();
 startTransition(() => {
 router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
 });
 }

 const totalPages = Math.max(1, Math.ceil(total / pageSize));
 const currentPage = Math.min(Math.max(1, page), totalPages);
 const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
 const endIdx = Math.min(currentPage * pageSize, total);

 const deptName = (code: string | null) =>
 code ? depts.find((d) => d.code === code)?.name ?? code :"—";

 function closeAndRefresh() {
 setEditing(null);
 setAdding(false);
 router.refresh();
 }

 return (
 <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
 <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h1 className="text-2xl font-extrabold tracking-tight text-odoo-text-strong">
 ຈັດການພະນັກງານ
 </h1>
 <p className="mt-1 text-sm text-odoo-text">
 ຈັດການ user ທີ່ຖືກເພີ່ມເຂົ້າ app ສຳລັບສິດ ແລະ ຕຳແໜ່ງ
 </p>
 </div>
 <button
 type="button"
 onClick={() => setAdding(true)}
 className="odoo-btn odoo-btn-primary self-start sm:self-auto"
 >
 <PlusIcon className="h-4 w-4" />
 ເພີ່ມ user ເຂົ້າ app
 </button>
 </div>

 <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
 <StatCard label="ທັງໝົດ" value={numFmt.format(activeCount + inactiveCount)} />
 <StatCard label="ໃຊ້ງານ" value={numFmt.format(activeCount)} />
 <StatCard label="ປິດໃຊ້ງານ" value={numFmt.format(inactiveCount)} />
 <StatCard label="ກອງແລ້ວ" value={numFmt.format(total)} />
 </div>

 <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
 <div className="flex-1">
 <div className="relative">
 <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-odoo-text-muted" />
 <input
 type="text"
 value={searchInput}
 onChange={(e) => setSearchInput(e.target.value)}
 placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່ / ຫຼິ້ນຊື່ / LINE ID"
 className="odoo-input py-2.5 pl-9 placeholder:text-odoo-text-soft"
 />
 </div>
 </div>
 </div>

 {total === 0 ? (
 <EmptyState />
 ) : (
 <>
 <div
 className={
"odoo-card overflow-hidden transition-opacity" +
 (isPending ? "opacity-60" : "opacity-100")
 }
 >
 <table className="hidden w-full text-sm md:table">
 <thead className="border-b border-odoo-border bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
 <tr>
 <th className="px-4 py-3">ລະຫັດ</th>
 <th className="px-4 py-3">ຊື່</th>
 <th className="px-4 py-3">ຫຼິ້ນຊື່</th>
 <th className="px-4 py-3">ພະແນກ</th>
 <th className="px-4 py-3">ຕຳແໜ່ງ</th>
 <th className="px-4 py-3">LINE</th>
 <th className="px-4 py-3">ສິດ</th>
 <th className="px-4 py-3">ສະຖານະ</th>
 <th className="px-4 py-3 text-right">ການກະທຳ</th>
 </tr>
 </thead>
 <tbody>
 {employees.map((e, i) => {
 const isActive = e.employmentStatus ==="ACTIVE";
 return (
 <tr
 key={e.employeeCode}
 className={
 i % 2 === 0
 ?"bg-white"
 :"bg-odoo-surface-muted/40"
 }
 >
 <td className="px-4 py-3 font-mono text-xs text-odoo-text">
 {e.employeeCode}
 </td>
 <td className="px-4 py-3">
 <div className="font-semibold text-odoo-text-strong">
 {e.fullnameLo ||"—"}
 </div>
 {e.fullnameEn ? (
 <div className="mt-0.5 text-xs font-normal text-odoo-text-muted">
 {e.fullnameEn}
 </div>
 ) : null}
 </td>
 <td className="px-4 py-3 text-odoo-text-strong">
 {e.nickname && e.nickname !=="0" ? e.nickname :"—"}
 </td>
 <td className="px-4 py-3 text-xs text-odoo-text">
 <span className="font-mono text-[10px] text-odoo-text-soft">{e.departmentCode}</span>
 <div>{deptName(e.departmentCode)}</div>
 </td>
 <td className="px-4 py-3 font-mono text-xs text-odoo-text">
 {e.positionCode ??"—"}
 </td>
 <td className="px-4 py-3 text-xs text-odoo-text">
 {e.lineId ??"—"}
 </td>
 <td className="px-4 py-3">
 <RoleCell
 employee={e}
 canAssign={canAssignRoles}
 />
 </td>
 <td className="px-4 py-3">
 <StatusBadge status={isActive ? "ACTIVE" : "INACTIVE"} />
 </td>
 <td className="px-4 py-3 text-right">
 <button
 type="button"
 onClick={() => setEditing(e)}
 className="inline-flex items-center gap-1 rounded-md border border-odoo-border bg-white px-3 py-1.5 text-xs font-bold text-odoo-text-strong transition hover:border-odoo-border-strong hover:bg-odoo-surface-muted"
 >
 ແກ້ໄຂ
 </button>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>

 <ul className="divide-y divide-odoo-border md:hidden">
 {employees.map((e) => {
 const isActive = e.employmentStatus ==="ACTIVE";
 return (
 <li key={e.employeeCode} className="px-4 py-3">
 <button
 type="button"
 onClick={() => setEditing(e)}
 className="w-full text-left"
 >
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <div className="truncate text-sm font-bold text-odoo-text-strong">
 {e.fullnameLo ||"—"}
 </div>
 <div className="mt-0.5 text-xs text-odoo-text-muted">
 <span className="font-mono">{e.employeeCode}</span>
 {e.nickname && e.nickname !=="0" ? <span> · {e.nickname}</span> : null}
 </div>
 <div className="mt-0.5 truncate text-xs text-odoo-text-muted">
 {deptName(e.departmentCode)}
 </div>
 <div className="mt-1">
 <RoleBadge role={e.appRole} isOverride={!!e.roleOverride} />
 </div>
 </div>
 <StatusBadge status={isActive ? "ACTIVE" : "INACTIVE"} />
 </div>
 </button>
 </li>
 );
 })}
 </ul>
 </div>

 <Pagination
 total={total}
 startIdx={startIdx}
 endIdx={endIdx}
 page={currentPage}
 totalPages={totalPages}
 pageSize={pageSize}
 disabled={isPending}
 onPageChange={(p) => pushParams({ page: String(p) })}
 onPageSizeChange={(s) => pushParams({ pageSize: String(s), page:"1" })}
 />
 </>
 )}

 {(editing || adding) && (
 <EmployeeModal
 employee={editing}
 mode={editing ? "edit" : "add"}
 depts={depts}
 availableEmployees={availableEmployees}
 currentEmployeeCode={currentEmployeeCode}
 onClose={() => {
 setEditing(null);
 setAdding(false);
 }}
 onSaved={closeAndRefresh}
 />
 )}
 </div>
 );
}

function EmployeeModal({
 employee,
 mode,
 depts,
 availableEmployees,
 currentEmployeeCode,
 onClose,
 onSaved,
}: {
 employee: Employee | null;
 mode:"add" |"edit";
 depts: ReadonlyArray<Dept>;
 availableEmployees: ReadonlyArray<AvailableEmployee>;
 currentEmployeeCode: string;
 onClose: () => void;
 onSaved: () => void;
}) {
 const action = mode ==="add" ? createEmployeeAction : updateEmployeeAction;
 const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

 useEffect(() => {
 if (state?.ok) onSaved();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [state]);

 const isSelf = mode ==="edit" && employee?.employeeCode === currentEmployeeCode;
 const deptNameMap = useMemo(() => {
 const m = new Map<string, string>();
 for (const d of depts) m.set(d.code, d.name);
 return m;
 }, [depts]);

 return (
 <div className="fixed inset-0 z-50 flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-4">
 <div className="flex max-h-[95vh] w-full max-w-xl flex-col overflow-hidden rounded-md border border-odoo-border bg-white">
 <div className="flex items-center justify-between border-b border-odoo-border px-5 py-4">
 <div>
 <div className="text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
 {mode ==="add" ? "ເພີ່ມ user ເຂົ້າ app" : "ແກ້ໄຂສິດ user"}
 </div>
 {employee && (
 <div className="mt-0.5 text-sm font-semibold text-odoo-text-strong">
 {employee.fullnameLo || employee.employeeCode}
 </div>
 )}
 </div>
 <button
 type="button"
 onClick={onClose}
 aria-label="ປິດ"
 className="rounded-md p-2 text-odoo-text-muted transition hover:bg-odoo-surface-muted"
 >
 <CloseIcon className="h-5 w-5" />
 </button>
 </div>

 <form action={formAction} className="flex-1 overflow-y-auto px-5 py-4">
 {mode ==="edit" ? (
 <input type="hidden" name="employeeCode" value={employee?.employeeCode ??""} />
 ) : null}

 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="ລະຫັດພະນັກງານ" required={mode ==="add"} className="sm:col-span-2">
 {mode ==="add" ? (
 <EmployeePicker
 employees={availableEmployees}
 deptNameMap={deptNameMap}
 />
 ) : (
 <input
 name="_employeeCode_readonly"
 defaultValue={employee?.employeeCode ??""}
 disabled
 className={inputCls +" disabled:bg-odoo-surface-muted"}
 />
 )}
 </Field>

 <Field label="ສິດໃນ app" required>
 <select
 name="appRole"
 defaultValue={employee?.appRole ??"salesperson"}
 className={inputCls}
 required
 >
 {ROLE_OPTIONS.map((r) => (
 <option key={r} value={r}>
 {ROLE_LABELS[r]}
 </option>
 ))}
 </select>
 </Field>

 <Field label="ສະຖານະໃນ app">
 <select
 name="isActive"
 defaultValue={employee?.employmentStatus ==="INACTIVE" ?"false" :"true"}
 className={inputCls}
 >
 <option value="true">ໃຊ້ງານ</option>
 <option value="false">ປິດໃຊ້ງານ</option>
 </select>
 </Field>
 </div>

 {employee ? (
 <div className="mt-4 rounded-md border border-odoo-border bg-odoo-surface-muted p-3 text-xs text-odoo-text">
 <div className="font-bold text-odoo-text-strong">ຂໍ້ມູນຈາກ odg_employee</div>
 <div className="mt-1">ຊື່: {employee.fullnameLo ||"—"}</div>
 <div>ພະແນກ: {employee.departmentCode ??"—"} · {employee.lineId ??"ບໍ່ມີ LINE"}</div>
 </div>
 ) : (
 <div className="mt-4 rounded-md border border-odoo-border bg-odoo-surface-muted p-3 text-xs text-odoo-text">
 ສະແດງສະເພາະພະນັກງານທີ່ມີໃນ odg_employee ແລະ ຍັງບໍ່ໄດ້ຖືກເພີ່ມເຂົ້າ app ({availableEmployees.length} ຄົນ).
 </div>
 )}

 {state && !state.ok && (
 <div className="odoo-alert-danger mt-4 px-3 py-2 text-sm">
 {state.error}
 </div>
 )}

 <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-odoo-border pt-4">
 {mode ==="edit" && employee && (
 <DeleteButton
 employeeCode={employee.employeeCode}
 disabled={isSelf}
 onDone={onSaved}
 />
 )}
 <button
 type="button"
 onClick={onClose}
 className="rounded-md border border-odoo-border bg-white px-4 py-2 text-sm font-semibold text-odoo-text-strong transition hover:bg-odoo-surface-muted"
 >
 ຍົກເລີກ
 </button>
 <button
 type="submit"
 disabled={pending}
 className="odoo-btn odoo-btn-primary"
 >
 {pending ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ"}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
}

function DeleteButton({
 employeeCode,
 disabled,
 onDone,
}: {
 employeeCode: string;
 disabled: boolean;
 onDone: () => void;
}) {
 const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(deleteEmployeeAction, null);
 const [confirming, setConfirming] = useState(false);

 useEffect(() => {
 if (state?.ok) onDone();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [state]);

 if (disabled) {
 return (
 <button
 type="button"
 disabled
 title="ບໍ່ສາມາດລຶບບັນຊີຂອງຕົນເອງ"
 className="rounded-md border border-odoo-border bg-white px-3 py-2 text-sm font-semibold text-odoo-text-soft"
 >
 ລຶບ
 </button>
 );
 }

 if (!confirming) {
 return (
 <button
 type="button"
 onClick={() => setConfirming(true)}
 className="odoo-btn odoo-btn-danger"
 >
 ລຶບ
 </button>
 );
 }

 return (
 <form action={formAction} className="inline-flex items-center gap-1">
 <input type="hidden" name="employeeCode" value={employeeCode} />
	 <span className="text-xs text-odoo-danger">ຢືນຢັນລຶບ?</span>
 <button
 type="submit"
 disabled={pending}
 className="odoo-btn odoo-btn-danger-fill"
 >
 {pending ? "…" : "ລຶບ"}
 </button>
 <button
 type="button"
 onClick={() => setConfirming(false)}
 className="rounded-md border border-odoo-border bg-white px-3 py-2 text-sm font-semibold text-odoo-text-strong"
 >
 ຍົກເລີກ
 </button>
 {state && !state.ok && (
	 <span className="text-xs text-odoo-danger">{state.error}</span>
 )}
 </form>
 );
}

const inputCls =
"w-full rounded-md border border-odoo-border bg-white px-3 py-2 text-sm text-odoo-text-strong outline-none transition focus:border-odoo-primary focus:ring-2 focus:ring-odoo-primary/20";

function Field({
 label,
 required,
 className,
 children,
}: {
 label: string;
 required?: boolean;
 className?: string;
 children: React.ReactNode;
}) {
 return (
 <label className={"block " + (className ??"")}>
 <div className="mb-1 text-xs font-semibold text-odoo-text">
 {label}
 {required && <span className="ml-0.5 text-odoo-danger">*</span>}
 </div>
 {children}
 </label>
 );
}

function EmployeePicker({
 employees,
 deptNameMap,
}: {
 employees: ReadonlyArray<AvailableEmployee>;
 deptNameMap: Map<string, string>;
}) {
 const [query, setQuery] = useState("");
 const [open, setOpen] = useState(false);
 const [selected, setSelected] = useState<AvailableEmployee | null>(null);
 const [activeIdx, setActiveIdx] = useState(0);
 const wrapRef = useRef<HTMLDivElement>(null);

 const filtered = useMemo(() => {
 const q = query.trim().toLowerCase();
 if (!q) return employees.slice(0, 50);
 return employees
 .filter((e) => {
 const hay = [e.code, e.fullnameLo, e.fullnameEn, e.nickname]
 .filter(Boolean)
 .join(" ")
 .toLowerCase();
 return hay.includes(q);
 })
 .slice(0, 50);
 }, [employees, query]);

 useEffect(() => {
 function onDocClick(ev: MouseEvent) {
 if (!wrapRef.current) return;
 if (!wrapRef.current.contains(ev.target as Node)) setOpen(false);
 }
 document.addEventListener("mousedown", onDocClick);
 return () => document.removeEventListener("mousedown", onDocClick);
 }, []);

  const [prevQuery, setPrevQuery] = useState(query);
  const [prevOpen, setPrevOpen] = useState(open);

  if (query !== prevQuery || open !== prevOpen) {
    setPrevQuery(query);
    setPrevOpen(open);
    setActiveIdx(0);
  }

 function pick(e: AvailableEmployee) {
 setSelected(e);
 setQuery("");
 setOpen(false);
 }

 function clear() {
 setSelected(null);
 setQuery("");
 setOpen(true);
 }

 if (employees.length === 0) {
 return (
 <div className={inputCls +" cursor-not-allowed bg-odoo-surface-muted text-odoo-text-muted"}>
 ບໍ່ມີພະນັກງານທີ່ສາມາດເພີ່ມໄດ້
 <input type="hidden" name="employeeCode" value="" />
 </div>
 );
 }

 return (
 <div ref={wrapRef} className="relative">
 <input type="hidden" name="employeeCode" value={selected?.code ?? ""} required />
 {selected ? (
 <div className="flex items-center justify-between gap-2 rounded-md border border-odoo-border bg-white px-3 py-2">
 <div className="min-w-0">
 <div className="text-sm font-semibold text-odoo-text-strong">
 <span className="font-mono text-xs text-odoo-text-soft">{selected.code}</span>
 <span className="ml-2">{selected.fullnameLo || selected.fullnameEn || "—"}</span>
 </div>
 <div className="mt-0.5 text-xs text-odoo-text-muted">
 {selected.departmentCode
 ? `${selected.departmentCode} · ${deptNameMap.get(selected.departmentCode) ?? selected.departmentCode}`
 : "ບໍ່ມີພະແນກ"}
 {selected.positionCode ? ` · ${selected.positionCode}` : ""}
 </div>
 </div>
 <button
 type="button"
 onClick={clear}
 className="rounded-md border border-odoo-border bg-white px-2 py-1 text-xs font-semibold text-odoo-text-strong transition hover:bg-odoo-surface-muted"
 >
 ປ່ຽນ
 </button>
 </div>
 ) : (
 <input
 type="text"
 value={query}
 onFocus={() => setOpen(true)}
 onChange={(e) => {
 setQuery(e.target.value);
 setOpen(true);
 }}
 onKeyDown={(e) => {
 if (e.key === "ArrowDown") {
 e.preventDefault();
 setOpen(true);
 setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
 } else if (e.key === "ArrowUp") {
 e.preventDefault();
 setActiveIdx((i) => Math.max(i - 1, 0));
 } else if (e.key === "Enter") {
 if (open && filtered[activeIdx]) {
 e.preventDefault();
 pick(filtered[activeIdx]);
 }
 } else if (e.key === "Escape") {
 setOpen(false);
 }
 }}
 placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່ / ຫຼິ້ນຊື່"
 className={inputCls}
 autoComplete="off"
 />
 )}
 {open && !selected && (
 <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-odoo-border bg-white shadow-lg">
 {filtered.length === 0 ? (
 <div className="px-3 py-2 text-xs text-odoo-text-muted">ບໍ່ພົບລາຍການ</div>
 ) : (
 filtered.map((e, idx) => (
 <button
 type="button"
 key={e.code}
 onClick={() => pick(e)}
 onMouseEnter={() => setActiveIdx(idx)}
 className={
 "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm " +
 (idx === activeIdx
 ? "bg-odoo-surface-muted"
 : "hover:bg-odoo-surface-muted")
 }
 >
 <div className="min-w-0">
 <div className="font-semibold text-odoo-text-strong">
 <span className="font-mono text-[10px] text-odoo-text-soft">{e.code}</span>
 <span className="ml-2">{e.fullnameLo || e.fullnameEn || "—"}</span>
 </div>
 <div className="mt-0.5 text-xs text-odoo-text-muted">
 {e.departmentCode
 ? `${e.departmentCode} · ${deptNameMap.get(e.departmentCode) ?? e.departmentCode}`
 : "—"}
 {e.nickname && e.nickname !== "0" ? ` · ${e.nickname}` : ""}
 </div>
 </div>
 </button>
 ))
 )}
 </div>
 )}
 </div>
 );
}

function StatCard({ label, value }: { label: string; value: string }) {
 return (
 <div className="odoo-card px-4 py-3">
 <div className="text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
 {label}
 </div>
 <div className="mt-1 text-xl font-extrabold tabular-nums text-odoo-text-strong">
 {value}
 </div>
 </div>
 );
}

function StatusBadge({ status }: { status: string }) {
 const label = STATUS_LABELS[status] ?? status;
 const cls =
 status ==="ACTIVE"
 ?"odoo-pill-success"
 :"bg-odoo-border text-odoo-text-strong";
 return (
 <span className={"inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold" + cls}>
 {label}
 </span>
 );
}

function EmptyState() {
 return (
 <div className="odoo-card border-dashed px-6 py-16 text-center">
 <UsersIcon className="mx-auto h-10 w-10 text-odoo-text-soft" />
 <p className="mt-3 text-sm font-bold text-odoo-text-strong">ບໍ່ພົບພະນັກງານ</p>
 <p className="mt-1 text-xs text-odoo-text-muted">ລອງປ່ຽນຕົວກອງ ຫຼື ຄຳຄົ້ນຫາ</p>
 </div>
 );
}

function Pagination({
 total,
 startIdx,
 endIdx,
 page,
 totalPages,
 pageSize,
 disabled,
 onPageChange,
 onPageSizeChange,
}: {
 total: number;
 startIdx: number;
 endIdx: number;
 page: number;
 totalPages: number;
 pageSize: number;
 disabled: boolean;
 onPageChange: (p: number) => void;
 onPageSizeChange: (s: number) => void;
}) {
 const pages = pageRange(page, totalPages);
 return (
 <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-3 text-xs text-odoo-text">
 <span>
 ສະແດງ{""}
 <span className="font-bold tabular-nums text-odoo-text-strong">
 {numFmt.format(startIdx)}–{numFmt.format(endIdx)}
 </span>{""}
 ຈາກ{""}
 <span className="font-bold tabular-nums text-odoo-text-strong">
 {numFmt.format(total)}
 </span>
 </span>
 <div className="flex items-center gap-2">
 <label htmlFor="page-size" className="hidden text-xs text-odoo-text-muted sm:inline">ຕໍ່ໜ້າ</label>
 <select
 id="page-size"
 value={pageSize}
 disabled={disabled}
 onChange={(e) => onPageSizeChange(Number(e.target.value))}
 className="rounded-md border border-odoo-border bg-white px-2 py-1 text-xs font-bold text-odoo-text-strong outline-none focus:border-odoo-border-strong disabled:opacity-50 border-odoo-border-strong"
 >
 {PAGE_SIZE_OPTIONS.map((n) => (
 <option key={n} value={n}>{n}</option>
 ))}
 </select>
 </div>
 </div>
 <div className="flex items-center gap-1">
 <PageBtn disabled={disabled || page <= 1} onClick={() => onPageChange(1)}>«</PageBtn>
 <PageBtn disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>‹</PageBtn>
 {pages.map((p, i) =>
 p ==="…" ? (
 <span key={`gap-${i}`} className="px-2 text-xs text-odoo-text-soft select-none">…</span>
 ) : (
 <PageBtn key={p} active={p === page} disabled={disabled} onClick={() => onPageChange(p)}>
 {p}
 </PageBtn>
 ),
 )}
 <PageBtn disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>›</PageBtn>
 <PageBtn disabled={disabled || page >= totalPages} onClick={() => onPageChange(totalPages)}>»</PageBtn>
 </div>
 </div>
 );
}

function PageBtn({
 children,
 active,
 disabled,
 onClick,
}: {
 children: React.ReactNode;
 active?: boolean;
 disabled?: boolean;
 onClick?: () => void;
}) {
 const base =
"inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums transition";
 let cls: string;
 if (active) {
 cls = `${base} border-odoo-border-strong bg-odoo-primary text-white`;
 } else if (disabled) {
 cls = `${base} border-odoo-border bg-white text-odoo-text-soft cursor-not-allowed`;
 } else {
 cls = `${base} border-odoo-border bg-white text-odoo-text-strong hover:border-odoo-border-strong hover:bg-odoo-surface-muted `;
 }
 return (
 <button type="button" onClick={onClick} disabled={disabled} className={cls}>
 {children}
 </button>
 );
}

function pageRange(current: number, total: number): Array<number |"…"> {
 if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
 const out: Array<number |"…"> = [1];
 const left = Math.max(2, current - 1);
 const right = Math.min(total - 1, current + 1);
 if (left > 2) out.push("…");
 for (let p = left; p <= right; p++) out.push(p);
 if (right < total - 1) out.push("…");
 out.push(total);
 return out;
}

function SearchIcon({ className }: { className?: string }) {
 return (
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
 <circle cx="11" cy="11" r="7" />
 <path d="m21 21-4.3-4.3" />
 </svg>
 );
}

function RoleBadge({
 role,
 isOverride,
}: {
 role: AppRole;
 isOverride?: boolean;
}) {
 const color: Record<AppRole, string> = {
 pc:"bg-odoo-surface-muted text-odoo-text-strong border-odoo-border-strong",
 salesperson:"bg-odoo-primary-50 text-odoo-primary border-odoo-primary-200",
 head:"odoo-pill-warning",
 manager:"odoo-pill-success",
 };
 return (
 <span className="inline-flex items-center gap-1">
 <span
 className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${color[role]}`}
 >
 {ROLE_LABELS[role]}
 </span>
 {isOverride ? (
 <span
 className="rounded-sm bg-odoo-danger-bg px-1 py-0.5 text-[9px] font-bold text-odoo-danger"
 title="ກຳນົດເອງ (override)"
 >
 *
 </span>
 ) : null}
 </span>
 );
}

function RoleCell({
 employee,
 canAssign,
}: {
 employee: Employee;
 canAssign: boolean;
}) {
 const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
 setRoleAction,
 null,
 );
 const isOverride = !!employee.roleOverride;
 if (!canAssign) {
 return <RoleBadge role={employee.appRole} isOverride={isOverride} />;
 }
 const errored = state && state.ok === false;
 return (
 <form
 action={formAction}
 className="flex items-center gap-2"
 title={errored ? state.error : undefined}
 >
 <input type="hidden" name="employeeCode" value={employee.employeeCode} />
 <select
 name="appRole"
 defaultValue={employee.appRole}
 disabled={pending}
 onChange={(ev) => {
 ev.currentTarget.form?.requestSubmit();
 }}
 className={`rounded-md border px-2 py-1 text-xs font-bold ${
 errored
 ?"border-odoo-danger-border bg-odoo-danger-bg text-odoo-danger"
 :"border-odoo-border-strong bg-white text-odoo-text-strong"
 } ${pending ? "opacity-60" : ""}`}
 >
 {ROLE_OPTIONS.map((r) => (
 <option key={r} value={r}>
 {ROLE_LABELS[r]}
 </option>
 ))}
 </select>
 {pending ? (
 <span className="text-[10px] font-bold text-odoo-text-soft">…</span>
 ) : null}
 </form>
 );
}

function PlusIcon({ className }: { className?: string }) {
 return (
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
 <path d="M12 5v14M5 12h14" />
 </svg>
 );
}

function CloseIcon({ className }: { className?: string }) {
 return (
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
 <path d="M18 6 6 18M6 6l12 12" />
 </svg>
 );
}

function UsersIcon({ className }: { className?: string }) {
 return (
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
 <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
 <circle cx="9" cy="7" r="4" />
 <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
 <path d="M16 3.13a4 4 0 0 1 0 7.75" />
 </svg>
 );
}
