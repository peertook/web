// worker/src/auth.js
// Session management + authentication middleware.

import {
  SESSION_COOKIE,
  ApiError,
  buildClearCookie,
  buildSessionCookie,
  clientIpHash,
  newId,
  nowSec,
  parseCookies,
  randomToken,
  userAgent,
} from "./utils.js";

const SESSION_TTL_DEFAULT = 60 * 60 * 24 * 7; // 7 days

function ttl(env) {
  const n = parseInt(env.SESSION_TTL || "", 10);
  return Number.isFinite(n) && n > 0 ? n : SESSION_TTL_DEFAULT;
}

export async function createSession(env, request, userId) {
  const id = newId("sess");
  const token = randomToken(32);
  const created = nowSec();
  const expires = created + ttl(env);
  const ipHash = await clientIpHash(request, env.SESSION_SECRET || "dev");
  const ua = userAgent(request);

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, created, expires, ua, ipHash)
    .run();

  return { token: `${id}.${token}`, expiresAt: expires };
}

export async function destroySession(env, request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return;
  const [id] = raw.split(".");
  if (!id) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
}

export async function getSession(env, request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const [id] = raw.split(".");
  if (!id) return null;

  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at,
            u.id AS uid, u.username, u.email, u.avatar_url, u.bio, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  )
    .bind(id)
    .first();

  if (!row) return null;
  if (row.expires_at < nowSec()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return null;
  }

  return {
    sessionId: row.id,
    user: {
      id: row.uid,
      username: row.username,
      email: row.email,
      avatar_url: row.avatar_url,
      bio: row.bio,
      created_at: row.created_at,
    },
  };
}

export async function requireUser(env, request) {
  const session = await getSession(env, request);
  if (!session) {
    throw new ApiError("UNAUTHORIZED", "Authentication required", 401);
  }
  return session.user;
}

export function sessionCookie(token, env) {
  return buildSessionCookie(token, ttl(env), { secure: true });
}

export function clearCookie() {
  return buildClearCookie();
}
