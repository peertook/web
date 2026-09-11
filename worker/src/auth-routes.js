// worker/src/auth-routes.js
// Authentication endpoints: register / login / logout / me.

import {
  ApiError,
  fail,
  hashPassword,
  newId,
  ok,
  sanitizeText,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./utils.js";
import {
  clearCookie,
  createSession,
  destroySession,
  getSession,
  sessionCookie,
} from "./auth.js";

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    avatar_url: u.avatar_url || null,
    bio: u.bio || "",
    created_at: u.created_at,
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }
}

/* POST /api/auth/register */
export async function register(request, env) {
  const body = await readJson(request);
  const username = sanitizeText(body.username, 24);
  const email = sanitizeText(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  const uErr = validateUsername(username);
  if (uErr) throw new ApiError("INVALID_USERNAME", uErr, 400);
  const eErr = validateEmail(email);
  if (eErr) throw new ApiError("INVALID_EMAIL", eErr, 400);
  const pErr = validatePassword(password);
  if (pErr) throw new ApiError("INVALID_PASSWORD", pErr, 400);

  const dupU = await env.DB.prepare(
    `SELECT id FROM users WHERE username = ? COLLATE NOCASE`
  )
    .bind(username)
    .first();
  if (dupU) throw new ApiError("USERNAME_TAKEN", "Username already in use", 409);

  const dupE = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? COLLATE NOCASE`
  )
    .bind(email)
    .first();
  if (dupE) throw new ApiError("EMAIL_TAKEN", "Email already registered", 409);

  const id = newId("usr");
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)`
  )
    .bind(id, username, email, hash)
    .run();

  const { token } = await createSession(env, request, id);

  const row = await env.DB.prepare(
    `SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?`
  )
    .bind(id)
    .first();

  return ok({ user: publicUser(row) }, 201, {
    "Set-Cookie": sessionCookie(token, env),
  });
}

/* POST /api/auth/login */
export async function login(request, env) {
  const body = await readJson(request);
  const identifier = sanitizeText(body.username || body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!identifier || !password) {
    throw new ApiError("INVALID_CREDENTIALS", "Missing credentials", 400);
  }

  const row = await env.DB.prepare(
    `SELECT id, username, email, password_hash, avatar_url, bio, created_at
       FROM users
      WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE`
  )
    .bind(identifier, identifier)
    .first();

  // Use constant-ish response to reduce user enumeration.
  if (!row) {
    await verifyPassword(password, "pbkdf2$150000$AAAA$AAAA"); // burn time
    throw new ApiError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  }

  const good = await verifyPassword(password, row.password_hash);
  if (!good) throw new ApiError("INVALID_CREDENTIALS", "Invalid credentials", 401);

  const { token } = await createSession(env, request, row.id);

  return ok({ user: publicUser(row) }, 200, {
    "Set-Cookie": sessionCookie(token, env),
  });
}

/* POST /api/auth/logout */
export async function logout(request, env) {
  await destroySession(env, request);
  return ok({ loggedOut: true }, 200, { "Set-Cookie": clearCookie() });
}

/* GET /api/auth/me */
export async function me(request, env) {
  const session = await getSession(env, request);
  if (!session) return ok({ user: null });
  return ok({ user: publicUser(session.user) });
}
