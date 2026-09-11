// worker/src/utils.js
// Shared helpers: JSON responses, IDs, validation, hashing, CORS.

const textEncoder = new TextEncoder();

/* ------------------------------------------------------------------ */
/* IDs                                                                 */
/* ------------------------------------------------------------------ */

export function newId(prefix = "") {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}_${hex}` : hex;
}

/* ------------------------------------------------------------------ */
/* JSON responses                                                      */
/* ------------------------------------------------------------------ */

export function ok(data = {}, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function fail(code, message, status = 400, extraHeaders = {}) {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
    }
  );
}

export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(username) {
  if (typeof username !== "string") return "Username must be a string";
  if (!USERNAME_RE.test(username))
    return "Username must be 3-24 chars: letters, numbers, underscore";
  return null;
}

export function validateEmail(email) {
  if (typeof email !== "string") return "Email must be a string";
  if (email.length > 254) return "Email too long";
  if (!EMAIL_RE.test(email)) return "Invalid email address";
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string") return "Password must be a string";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 200) return "Password too long";
  return null;
}

export function sanitizeText(input, maxLen = 5000) {
  if (typeof input !== "string") return "";
  // strip control chars, normalize
  let out = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out.trim();
}

/* ------------------------------------------------------------------ */
/* Crypto                                                              */
/* ------------------------------------------------------------------ */

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* Password hashing (PBKDF2-SHA256)                                    */
/* ------------------------------------------------------------------ */

const PBKDF2_ITER = 150000;
const PBKDF2_KEYLEN = 32;

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    PBKDF2_KEYLEN * 8
  );
  return `pbkdf2$${PBKDF2_ITER}$${bufToB64(salt)}$${bufToB64(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iter = parseInt(parts[1], 10);
    const salt = b64ToBuf(parts[2]);
    const expected = b64ToBuf(parts[3]);
    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
        key,
        expected.byteLength * 8
      )
    );
    if (bits.byteLength !== expected.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < bits.byteLength; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = "peertook_session";

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildSessionCookie(token, ttlSeconds, { secure = true } = {}) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${ttlSeconds}`,
    "SameSite=None",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=None; Secure`;
}

/* ------------------------------------------------------------------ */
/* CORS                                                                */
/* ------------------------------------------------------------------ */

export function corsHeaders(origin, allowedList) {
  const allowed = (allowedList || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(resp, origin, allowedList) {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowedList))) {
    headers.set(k, v);
  }
  return new Response(resp.body, { status: resp.status, headers });
}

/* ------------------------------------------------------------------ */
/* Client info                                                         */
/* ------------------------------------------------------------------ */

export function clientIpHash(request, secret) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "0.0.0.0";
  return hmacHex(secret, ip.split(",")[0].trim());
}

export function userAgent(request) {
  return (request.headers.get("User-Agent") || "").slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
