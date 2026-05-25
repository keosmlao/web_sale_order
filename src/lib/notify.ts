// Firebase Cloud Messaging — server-side send via firebase-admin.
//
// Required env:
//   FCM_SERVICE_ACCOUNT_JSON  Full JSON string of the Firebase service
//                             account (Project Settings → Service accounts →
//                             Generate new private key). Keep this secret.
//
// If FCM_SERVICE_ACCOUNT_JSON is missing, all calls become silent no-ops so
// the app keeps working during development without a Firebase project.

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { prisma } from "@/lib/prisma";

let initialised = false;
let initFailedLogged = false;

function ensureApp() {
  if (initialised) return getApp();
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    if (!initFailedLogged) {
      console.warn(
        "[notify] FCM_SERVICE_ACCOUNT_JSON not set — push notifications disabled",
      );
      initFailedLogged = true;
    }
    return null;
  }
  if (getApps().length === 0) {
    let creds: unknown;
    try {
      creds = JSON.parse(raw);
    } catch (e) {
      console.error("[notify] FCM_SERVICE_ACCOUNT_JSON is not valid JSON", e);
      return null;
    }
    initializeApp({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credential: cert(creds as any),
    });
  }
  initialised = true;
  return getApp();
}

export type PushPayload = {
  title: string;
  body: string;
  // Extra key/value pairs delivered with the message. Used by the mobile app
  // to navigate to a specific screen when the user taps the notification.
  data?: Record<string, string>;
};

// Sends a push to every device registered for any of the given employees.
// Cleans up stale tokens (UNREGISTERED / INVALID_ARGUMENT) so the queue
// doesn't grow forever.
export async function notifyEmployees(
  employeeCodes: string[],
  payload: PushPayload,
): Promise<void> {
  const codes = employeeCodes.filter((c) => c && c.trim().length > 0);
  if (codes.length === 0) return;
  const app = ensureApp();
  if (!app) return;

  const rows = await prisma.appFcmToken.findMany({
    where: { employeeCode: { in: codes } },
    select: { id: true, token: true },
  });
  if (rows.length === 0) return;

  const messaging = getMessaging(app);
  const res = await messaging.sendEachForMulticast({
    tokens: rows.map((r) => r.token),
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    android: {
      priority: "high",
      notification: { channelId: "default", sound: "default" },
    },
    apns: {
      payload: { aps: { sound: "default" } },
    },
  });

  const staleTokenIds: bigint[] = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      staleTokenIds.push(rows[i].id);
    } else {
      console.warn("[notify] send failed:", code, r.error?.message);
    }
  });
  if (staleTokenIds.length > 0) {
    await prisma.appFcmToken.deleteMany({
      where: { id: { in: staleTokenIds } },
    });
  }
}

// Convenience for "everyone with this role". Matches the role-derivation
// rules from lib/roles.ts: explicit `app_role` override wins; otherwise the
// position_code maps to a role (11=manager, 12=head, 13=salesperson). So a
// position-11 employee with app_role='salesperson' is NOT a manager.
const POSITION_FOR_ROLE: Record<string, string> = {
  manager: "11",
  head: "12",
  salesperson: "13",
};

export async function notifyByRole(
  role: "manager" | "head" | "salesperson" | "pc",
  payload: PushPayload,
): Promise<void> {
  const positionCode = POSITION_FOR_ROLE[role];
  const employees = await prisma.odgEmployee.findMany({
    where: {
      employeeCode: { not: null },
      OR: [
        { appRole: role },
        positionCode
          ? { appRole: null, positionCode }
          : { appRole: null, positionCode: { not: null } },
      ],
    },
    select: { employeeCode: true },
  });
  const codes = Array.from(
    new Set(
      employees.map((e) => e.employeeCode).filter((c): c is string => !!c),
    ),
  );
  await notifyEmployees(codes, payload);
}
