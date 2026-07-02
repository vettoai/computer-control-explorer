// Password-gate helpers for the optional EXPLORER_PASSWORD lock (see src/proxy.ts).
// Pure functions over node:crypto so the proxy stays a thin request handler.
import { createHash, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "explorer_auth";

/** The value stored in the auth cookie: a salted digest, never the password itself. */
export function authTokenFor(password: string): string {
  return createHash("sha256").update(`explorer-auth-v1:${password}`).digest("hex");
}

/** Constant-time string comparison; hashing both sides first equalizes lengths. */
function secureEquals(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function isValidAuthCookie(cookieValue: string, password: string): boolean {
  return secureEquals(cookieValue, authTokenFor(password));
}

export function passwordMatches(supplied: string, password: string): boolean {
  return secureEquals(supplied, password);
}

/**
 * Where to send the user after login. Only same-origin absolute paths are honored
 * (rejects `//host` and `/\host` protocol-relative forms), so ?from= can't be used
 * as an open redirect.
 */
export function safeRedirectPath(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/")) return "/";
  if (from.startsWith("//") || from.startsWith("/\\")) return "/";
  return from;
}
