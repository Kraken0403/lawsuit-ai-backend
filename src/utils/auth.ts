import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { CookieOptions, Response } from "express";

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "lawsuit_ai_session";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function getCookieSameSite(): CookieOptions["sameSite"] {
  const raw = String(process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
  if (raw === "strict" || raw === "none" || raw === "lax") return raw;
  return "lax";
}

function getCookieOptions(): CookieOptions {
  const sameSite = getCookieSameSite();
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production" ||
    sameSite === "none";

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiryDate() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, getCookieOptions());
}

export function clearSessionCookie(res: Response) {
  const options = getCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
    path: options.path,
    domain: options.domain,
  });
}

export function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

export function deriveConversationTitle(text: string) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (!clean) return "New chat";
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 60).trim()}...`;
}