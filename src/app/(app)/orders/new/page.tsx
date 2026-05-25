import { requireEmployee } from "@/lib/auth";
import CreateOrderClient from "./CreateOrderClient";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const me = await requireEmployee();

  return (
    <CreateOrderClient
      me={{
        employeeCode: me.employeeCode ?? "",
        fullnameLo: me.fullnameLo,
        nickname: me.nickname,
      }}
    />
  );
}
