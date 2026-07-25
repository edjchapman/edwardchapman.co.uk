/**
 * Per-visitor question quota via a signed HTTP-only cookie (ADR-0024). The
 * counter lives in the visitor's browser — the server holds only the HMAC
 * secret — so the quota adds no stateful infrastructure (spec §3). A missing,
 * malformed, or tampered cookie always degrades to a fresh window: the layer
 * fails open per-visitor, and the IP limiter (ADR-0009) plus the global spend
 * guard bound what a cookieless client can do.
 */

export const QUOTA_WINDOW_SECONDS = 86_400;
export const DEFAULT_QUOTA_LIMIT = 10;
export const QUOTA_COOKIE_NAME = "ask_quota";

const VERSION = "v1";

export interface QuotaOptions {
  cookieHeader: string | null;
  secret: string;
  limit: number;
  nowMs: number;
  /** Adds `Secure` — on for the canonical host (always, in practice:
   * wrangler dev presents the canonical host too), off for plain-localhost
   * callers such as unit tests. */
  secure: boolean;
}

export interface QuotaDecision {
  allowed: boolean;
  /** Present when allowed: the refreshed cookie to attach to the response. */
  setCookie?: string;
}

interface QuotaState {
  windowStartSec: number;
  count: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64url(signature: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Mint a cookie value; exported so tests can construct valid cookies. */
export async function signQuotaValue(
  windowStartSec: number,
  count: number,
  secret: string,
): Promise<string> {
  const payload = `${VERSION}.${windowStartSec}.${count}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(signature)}`;
}

function parseCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === QUOTA_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/** Digit bounds reject absurd values before Number(); counts above four
 * digits exceed any real limit and epoch seconds fit in twelve. */
async function verifyQuotaValue(
  value: string,
  secret: string,
): Promise<QuotaState | null> {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const startPart = parts[1] ?? "";
  const countPart = parts[2] ?? "";
  const signaturePart = parts[3] ?? "";
  if (!/^\d{1,12}$/.test(startPart) || !/^\d{1,4}$/.test(countPart)) {
    return null;
  }
  const signature = fromBase64url(signaturePart);
  if (!signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    new TextEncoder().encode(`${VERSION}.${startPart}.${countPart}`),
  );
  if (!valid) return null;
  return { windowStartSec: Number(startPart), count: Number(countPart) };
}

function serializeCookie(value: string, secure: boolean): string {
  const attributes = [
    `${QUOTA_COOKIE_NAME}=${value}`,
    `Max-Age=${QUOTA_WINDOW_SECONDS}`,
    "Path=/api/ask",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * Fixed window from the first question. Expired (or future-dated) windows
 * reset; a verified in-window cookie at the limit denies without a Set-Cookie
 * — the existing cookie's Max-Age already outlives the window.
 */
export async function evaluateQuota(
  options: QuotaOptions,
): Promise<QuotaDecision> {
  const { cookieHeader, secret, limit, nowMs, secure } = options;
  const nowSec = Math.floor(nowMs / 1000);
  const value = parseCookieHeader(cookieHeader);
  const state = value ? await verifyQuotaValue(value, secret) : null;
  const inWindow =
    state !== null &&
    state.windowStartSec <= nowSec &&
    nowSec - state.windowStartSec < QUOTA_WINDOW_SECONDS;
  if (!inWindow) {
    const fresh = await signQuotaValue(nowSec, 1, secret);
    return { allowed: true, setCookie: serializeCookie(fresh, secure) };
  }
  if (state.count >= limit) return { allowed: false };
  const next = await signQuotaValue(
    state.windowStartSec,
    state.count + 1,
    secret,
  );
  return { allowed: true, setCookie: serializeCookie(next, secure) };
}
