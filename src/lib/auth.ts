import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "odg_session";
export const SESSION_COOKIE_NAME = COOKIE_NAME;
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

const scrypt = promisify(scryptCallback);

type SessionPayload = {
  code: string;
  exp: number;
};

type AccessOverride = {
  app_role: string | null;
  position_code: string | null;
  is_active: boolean;
};

async function applyAccessOverride<T extends {
  employeeCode: string | null;
  appRole: string | null;
  positionCode: string | null;
}>(employee: T | null): Promise<T | null> {
  if (!employee?.employeeCode) return employee;
  const rows = await prisma.$queryRaw<AccessOverride[]>`
    SELECT app_role, position_code, is_active
    FROM app_employee_access
    WHERE employee_code = ${employee.employeeCode}
    LIMIT 1
  `;
  const access = rows[0];
  if (!access?.is_active) return employee;
  return {
    ...employee,
    appRole: access.app_role ?? employee.appRole,
    positionCode: access.position_code ?? employee.positionCode,
  };
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isPasswordHash(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  storedPassword: string | null | undefined,
  candidatePassword: string,
): Promise<boolean> {
  if (!storedPassword) return false;

  if (!isPasswordHash(storedPassword)) {
    return storedPassword === candidatePassword;
  }

  const [, salt, storedKey] = storedPassword.split("$");
  if (!salt || !storedKey) return false;

  const candidateKey = (await scrypt(
    candidatePassword,
    salt,
    PASSWORD_KEY_LENGTH,
  )) as Buffer;
  const storedKeyBuffer = Buffer.from(storedKey, "base64url");
  if (storedKeyBuffer.length !== candidateKey.length) return false;
  return timingSafeEqual(storedKeyBuffer, candidateKey);
}

export function createSessionToken(code: string): string {
  const payload: SessionPayload = {
    code,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  if (!safeEqual(signature, sign(payloadB64))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as SessionPayload;
    if (typeof payload.code !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(code: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export const getCurrentEmployee = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  const employee = await prisma.odgEmployee.findUnique({ where: { employeeCode: session.code } });
  return applyAccessOverride(employee);
});

export async function requireEmployee() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  return employee;
}

export async function getEmployeeFromRequest(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  let token: string | null = null;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }
  if (!token) {
    token = request.cookies.get(COOKIE_NAME)?.value ?? null;
  }
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  const employee = await prisma.odgEmployee.findUnique({ where: { employeeCode: session.code } });
  return applyAccessOverride(employee);
}
