"use client";

import { useState, type ReactNode } from "react";
import IncentiveConfigClient from "./IncentiveConfigClient";
import RoleCommissionEditor from "./RoleCommissionEditor";
import CommissionTierEditor from "./CommissionTierEditor";
import TargetPivotEditor from "./TargetPivotEditor";
import RewardsEditor from "./RewardsEditor";
import UnitRewardsEditor from "./UnitRewardsEditor";
import PointMapEditor from "./PointMapEditor";
import NoBonusItemsEditor from "./NoBonusItemsEditor";
import CategoryEditor from "./CategoryEditor";
import PointmapCategoryEditor from "./PointmapCategoryEditor";
import styles from "./incentives.module.css";

type TabKey = "config" | "targets" | "rewards" | "points";
type IconName = "sliders" | "target" | "gift" | "sparkles" | "ban" | "shield" | "chevron";

const TABS: { key: TabKey; eyebrow: string; label: string; icon: IconName; hint: string; summary: string }[] = [
  { key: "config", eyebrow: "01 · ພື້ນຖານ", label: "ສູດ & ເປົ້າ", icon: "sliders", hint: "ກຳນົດກົດກາການຄຳນວນ Incentive", summary: "ໂບນັດ, ເກນຜົນງານ ແລະ ຄ່າຄອມ" },
  { key: "targets", eyebrow: "02 · ທີມຂາຍ", label: "ເປົ້າຂາຍ", icon: "target", hint: "ບໍລິຫານເປົ້າຂາຍລາຍເດືອນ", summary: "ຕັ້ງເປົ້າ CE / AC ໃຫ້ພະນັກງານແຕ່ລະຄົນ" },
  { key: "rewards", eyebrow: "03 · ລາງວັນ", label: "ເງິນພິເສດ", icon: "gift", hint: "ອອກແບບລາງວັນເພີ່ມແຮງຈູງໃຈ", summary: "ລາງວັນລວມພະແນກ ແລະ ລາງວັນຕໍ່ຊຸດ" },
  { key: "points", eyebrow: "04 · ຄະແນນ", label: "Point Map", icon: "sparkles", hint: "ຈັດການຄະແນນໂບນັດ ແລະ ສິນຄ້າຍົກເວັ້ນ", summary: "ຄະແນນຕາມສິນຄ້າ + ສິນຄ້າບໍ່ນັບໂບນັດ" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /><circle cx="14" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m15 9 5-5M16 4h4v4" /></>,
    gift: <><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7H8.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7ZM12 7h3.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5.5 13l.8 2.2 2.2.8-2.2.8L5.5 19l-.8-2.2-2.2-.8 2.2-.8.8-2.2ZM18.5 14l.6 1.6 1.4.4-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.4.6-1.6Z" /></>,
    ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
    shield: <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

export default function IncentiveSettingsClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<TabKey>("config");
  const [pointsTab, setPointsTab] = useState<"map" | "exclusions" | "categories">("map");
  const [pmVersion, setPmVersion] = useState(0);
  const active = TABS.find((item) => item.key === tab) ?? TABS[0];

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroTopline}>
          <span className={styles.breadcrumb}>SETTINGS <span>/</span> INCENTIVES</span>
          <span className={canManage ? styles.accessEdit : styles.accessRead}>
            <Icon name="shield" /> {canManage ? "ສາມາດແກ້ໄຂ" : "ອ່ານຢ່າງດຽວ"}
          </span>
        </div>
        <div className={styles.heroContent}>
          <div>
            <p className={styles.kicker}>INCENTIVE CONTROL CENTER</p>
            <h1>ຈັດການແຮງຈູງໃຈ<br /><span>ໃຫ້ຊັດເຈນ ແລະ ເປັນທຳ</span></h1>
            <p className={styles.heroCopy}>ສູນລວມການຕັ້ງຄ່າເປົ້າ, ຄ່າຄອມ, ລາງວັນ ແລະ ຄະແນນສິນຄ້າ ສຳລັບທີມຂາຍ.</p>
          </div>
          <div className={styles.heroMark}><span>4</span><small>ກຸ່ມການຕັ້ງຄ່າ</small></div>
        </div>
      </header>

      <nav className={styles.navGrid} aria-label="ກຸ່ມການຕັ້ງຄ່າ Incentive">
        {TABS.map((item) => {
          const selected = tab === item.key;
          return (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`${styles.navCard} ${selected ? styles.navCardActive : ""}`} aria-current={selected ? "page" : undefined}>
              <span className={styles.navIcon}><Icon name={item.icon} /></span>
              <span className={styles.navText}><small>{item.eyebrow}</small><strong>{item.label}</strong><span>{item.summary}</span></span>
              <span className={styles.navArrow}><Icon name="chevron" /></span>
            </button>
          );
        })}
      </nav>

      <section className={styles.workspace}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionIcon}><Icon name={active.icon} /></div>
          <div><span>{active.eyebrow}</span><h2>{active.label}</h2><p>{active.hint}</p></div>
        </div>

        <div className={styles.panel}>
          <div className={tab === "config" ? styles.panelActive : styles.panelHidden}>
            <IncentiveConfigClient canManage={canManage} embedded />
            <RoleCommissionEditor canManage={canManage} />
            <CommissionTierEditor canManage={canManage} />
          </div>
          <div className={tab === "targets" ? styles.panelActive : styles.panelHidden}><TargetPivotEditor canManage={canManage} /></div>
          <div className={tab === "rewards" ? `${styles.panelActive} ${styles.stack}` : styles.panelHidden}><RewardsEditor canManage={canManage} /><UnitRewardsEditor canManage={canManage} /></div>
          <div className={tab === "points" ? styles.panelActive : styles.panelHidden}>
            <div className={styles.subTabs} role="tablist" aria-label="ຄະແນນໂບນັດ">
              <button type="button" role="tab" aria-selected={pointsTab === "map"} onClick={() => setPointsTab("map")} className={pointsTab === "map" ? styles.subTabActive : styles.subTab}>
                <Icon name="sparkles" /> ຄະແນນໂບນັດ (Point Map)
              </button>
              <button type="button" role="tab" aria-selected={pointsTab === "exclusions"} onClick={() => setPointsTab("exclusions")} className={pointsTab === "exclusions" ? styles.subTabActive : styles.subTab}>
                <Icon name="ban" /> ສິນຄ້າຍົກເວັ້ນຄະແນນ (ບໍ່ນັບໂບນັດ)
              </button>
              <button type="button" role="tab" aria-selected={pointsTab === "categories"} onClick={() => setPointsTab("categories")} className={pointsTab === "categories" ? styles.subTabActive : styles.subTab}>
                <Icon name="sliders" /> ໝວດສິນຄ້າ (Category Map)
              </button>
            </div>
            <div className={pointsTab === "map" ? "" : "hidden"}><PointMapEditor canManage={canManage} /></div>
            <div className={pointsTab === "exclusions" ? "" : "hidden"}><NoBonusItemsEditor canManage={canManage} /></div>
            <div className={pointsTab === "categories" ? `${styles.stack}` : "hidden"}>
              <PointmapCategoryEditor canManage={canManage} onChange={() => setPmVersion((v) => v + 1)} />
              <CategoryEditor canManage={canManage} pointmapVersion={pmVersion} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
