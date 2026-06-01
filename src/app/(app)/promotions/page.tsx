import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { canManagePromotions, roleFromEmployee } from "@/lib/roles";
import {
  autoCloseExpiredPromotions,
  serializePromotion,
} from "@/lib/promotions";
import PromotionsClient from "./PromotionsClient";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);

  // Lazily flip off any promo whose end date has passed before we read the
  // list, so the page never shows an expired promo as "ເປີດ".
  await autoCloseExpiredPromotions();

  const rows = await prisma.appPromotion.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  return (
    <PromotionsClient
      initialPromotions={rows.map(serializePromotion)}
      canManage={canManagePromotions(role)}
    />
  );
}
