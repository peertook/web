// worker/src/users.js
// Public profile + self-update endpoints.

import { requireUser } from "./auth.js";
import {
  ApiError,
  clamp,
  ok,
  sanitizeText,
  toInt,
} from "./utils.js";

const MAX_BIO = 500;
const MAX_AVATAR_URL = 500;

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    avatar_url: u.avatar_url || null,
    bio: u.bio || "",
    created_at: u.created_at,
  };
}

/* GET /api/users/:username */
export async function getProfile(request, env, ctx, params) {
  const username = sanitizeText(params.username, 24);
  if (!username) throw new ApiError("INVALID_USERNAME", "Username required", 400);

  const user = await env.DB.prepare(
    `SELECT id, username, avatar_url, bio, created_at FROM users WHERE username = ? COLLATE NOCASE`
  )
    .bind(username)
    .first();

  if (!user) throw new ApiError("NOT_FOUND", "User not found", 404);

  const [videoCount, totalViews, subCount] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM videos WHERE user_id = ? AND visibility = 'public'`)
      .bind(user.id)
      .first(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(views),0) AS v FROM videos WHERE user_id = ? AND visibility = 'public'`
    )
      .bind(user.id)
      .first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE channel_id = ?`)
      .bind(user.id)
      .first(),
  ]);

  return ok({
    user: publicUser(user),
    stats: {
      video_count: videoCount?.c || 0,
      total_views: totalViews?.v || 0,
      subscriber_count: subCount?.c || 0,
    },
  });
}

/* PATCH /api/users/me */
export async function updateMe(request, env) {
  const me = await requireUser(env, request);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }

  const updates = {};
  if (typeof body.bio === "string") {
    updates.bio = sanitizeText(body.bio, MAX_BIO);
  }
  if (typeof body.avatar_url === "string" || body.avatar_url === null) {
    const url = body.avatar_url === null ? null : sanitizeText(body.avatar_url, MAX_AVATAR_URL);
    if (url && !/^https?:\/\//i.test(url)) {
      throw new ApiError("INVALID_AVATAR", "Avatar URL must be http(s)", 400);
    }
    updates.avatar_url = url;
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError("NO_CHANGES", "No valid fields to update", 400);
  }

  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates);
  values.push(me.id);

  await env.DB.prepare(`UPDATE users SET ${fields} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, username, avatar_url, bio, created_at FROM users WHERE id = ?`
  )
    .bind(me.id)
    .first();

  return ok({ user: publicUser(row) });
}

/* GET /api/users/:username/videos?page=1&limit=12 */
export async function getUserVideos(request, env, ctx, params) {
  const username = sanitizeText(params.username, 24);
  if (!username) throw new ApiError("INVALID_USERNAME", "Username required", 400);

  const url = new URL(request.url);
  const page = clamp(toInt(url.searchParams.get("page"), 1), 1, 10000);
  const limit = clamp(toInt(url.searchParams.get("limit"), 12), 1, 50);
  const offset = (page - 1) * limit;

  const user = await env.DB.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`)
    .bind(username)
    .first();
  if (!user) throw new ApiError("NOT_FOUND", "User not found", 404);

  const rows = await env.DB.prepare(
    `SELECT v.id, v.title, v.thumbnail_key, v.duration, v.views, v.created_at,
            v.visibility, v.user_id,
            u.username
       FROM videos v
       JOIN users u ON u.id = v.user_id
      WHERE v.user_id = ? AND v.visibility = 'public'
      ORDER BY v.created_at DESC
      LIMIT ? OFFSET ?`
  )
    .bind(user.id, limit, offset)
    .all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM videos WHERE user_id = ? AND visibility = 'public'`
  )
    .bind(user.id)
    .first();

  return ok({
    videos: rows.results || [],
    page,
    limit,
    total: total?.c || 0,
  });
}
