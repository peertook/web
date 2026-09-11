// worker/src/videos.js
// Video listing, detail, update, delete, view counting, search.

import { requireUser, getSession } from "./auth.js";
import {
  ApiError,
  clamp,
  clientIpHash,
  hmacHex,
  newId,
  nowSec,
  ok,
  sanitizeText,
  toInt,
} from "./utils.js";

const VIEW_COOLDOWN_SECONDS = 6 * 60 * 60; // 6h per (video, viewer)

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function mediaUrl(env, key) {
  if (!key) return null;
  const base = (env.PUBLIC_MEDIA_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/${key}` : null;
}

function shapeVideo(env, row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    thumbnail_url: mediaUrl(env, row.thumbnail_key),
    video_url: mediaUrl(env, row.video_key),
    duration: row.duration || 0,
    views: row.views || 0,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
    uploader: {
      id: row.user_id,
      username: row.username,
      avatar_url: row.avatar_url || null,
    },
  };
}

function listSelect(env) {
  // Compute public media base at response time.
  return env;
}

/* ------------------------------------------------------------------ */
/* GET /api/videos?page=1&limit=24&sort=recent|trending|views           */
/* ------------------------------------------------------------------ */

export async function list(request, env) {
  const url = new URL(request.url);
  const page = clamp(toInt(url.searchParams.get("page"), 1), 1, 10000);
  const limit = clamp(toInt(url.searchParams.get("limit"), 24), 1, 60);
  const sort = url.searchParams.get("sort") || "recent";
  const offset = (page - 1) * limit;

  let orderBy = "v.created_at DESC";
  if (sort === "views") orderBy = "v.views DESC, v.created_at DESC";
  if (sort === "trending")
    orderBy = "(v.views * 1.0 / (1 + (strftime('%s','now') - v.created_at)/86400.0)) DESC";

  const rows = await env.DB.prepare(
    `SELECT v.id, v.title, v.description, v.video_key, v.thumbnail_key,
            v.duration, v.views, v.visibility, v.created_at, v.updated_at,
            v.user_id, u.username, u.avatar_url
       FROM videos v
       JOIN users u ON u.id = v.user_id
      WHERE v.visibility = 'public' AND v.status = 'ready'
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM videos WHERE visibility = 'public' AND status = 'ready'`
  ).first();

  return ok({
    videos: (rows.results || []).map((r) => shapeVideo(env, r)),
    page,
    limit,
    total: total?.c || 0,
  });
}

/* ------------------------------------------------------------------ */
/* GET /api/videos/:id                                                 */
/* ------------------------------------------------------------------ */

export async function getOne(request, env, ctx, params) {
  const id = sanitizeText(params.id, 64);
  const session = await getSession(env, request);
  const viewerId = session?.user?.id || null;

  const row = await env.DB.prepare(
    `SELECT v.id, v.title, v.description, v.video_key, v.thumbnail_key,
            v.duration, v.views, v.visibility, v.status,
            v.created_at, v.updated_at, v.user_id,
            u.username, u.avatar_url
       FROM videos v
       JOIN users u ON u.id = v.user_id
      WHERE v.id = ?`
  )
    .bind(id)
    .first();

  if (!row) throw new ApiError("NOT_FOUND", "Video not found", 404);

  if (row.visibility === "private" && row.user_id !== viewerId) {
    throw new ApiError("NOT_FOUND", "Video not found", 404);
  }

  const [likeCount, liked, commentCount] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM likes WHERE video_id = ?`).bind(id).first(),
    viewerId
      ? env.DB.prepare(`SELECT 1 AS x FROM likes WHERE video_id = ? AND user_id = ?`)
          .bind(id, viewerId)
          .first()
      : Promise.resolve(null),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM comments WHERE video_id = ?`).bind(id).first(),
  ]);

  return ok({
    video: shapeVideo(env, row),
    likes: likeCount?.c || 0,
    liked: !!liked,
    comment_count: commentCount?.c || 0,
  });
}

/* ------------------------------------------------------------------ */
/* PATCH /api/videos/:id                                               */
/* ------------------------------------------------------------------ */

export async function update(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  const row = await env.DB.prepare(`SELECT user_id FROM videos WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "Video not found", 404);
  if (row.user_id !== me.id) throw new ApiError("FORBIDDEN", "Not your video", 403);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }

  const updates = {};
  if (typeof body.title === "string") {
    const t = sanitizeText(body.title, 150);
    if (!t) throw new ApiError("INVALID_TITLE", "Title cannot be empty", 400);
    updates.title = t;
  }
  if (typeof body.description === "string") {
    updates.description = sanitizeText(body.description, 5000);
  }
  if (typeof body.visibility === "string") {
    if (!["public", "unlisted", "private"].includes(body.visibility)) {
      throw new ApiError("INVALID_VISIBILITY", "Invalid visibility", 400);
    }
    updates.visibility = body.visibility;
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError("NO_CHANGES", "No valid fields to update", 400);
  }

  updates.updated_at = nowSec();

  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates);
  values.push(id);

  await env.DB.prepare(`UPDATE videos SET ${fields} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare(
    `SELECT v.id, v.title, v.description, v.video_key, v.thumbnail_key,
            v.duration, v.views, v.visibility, v.created_at, v.updated_at,
            v.user_id, u.username, u.avatar_url
       FROM videos v JOIN users u ON u.id = v.user_id
      WHERE v.id = ?`
  )
    .bind(id)
    .first();

  return ok({ video: shapeVideo(env, updated) });
}

/* ------------------------------------------------------------------ */
/* DELETE /api/videos/:id                                              */
/* ------------------------------------------------------------------ */

export async function remove(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  const row = await env.DB.prepare(
    `SELECT user_id, video_key, thumbnail_key FROM videos WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "Video not found", 404);
  if (row.user_id !== me.id) throw new ApiError("FORBIDDEN", "Not your video", 403);

  await env.DB.prepare(`DELETE FROM videos WHERE id = ?`).bind(id).run();

  // Best-effort cleanup of R2 objects.
  try {
    const deletions = [];
    if (row.video_key) deletions.push(env.MEDIA.delete(row.video_key));
    if (row.thumbnail_key) deletions.push(env.MEDIA.delete(row.thumbnail_key));
    await Promise.allSettled(deletions);
  } catch (e) {
    console.warn("R2 cleanup warning:", e && e.message);
  }

  return ok({ deleted: true });
}

/* ------------------------------------------------------------------ */
/* POST /api/videos/:id/view                                           */
/* ------------------------------------------------------------------ */

export async function recordView(request, env, ctx, params) {
  const id = sanitizeText(params.id, 64);
  const session = await getSession(env, request);
  const userId = session?.user?.id || null;

  const video = await env.DB.prepare(
    `SELECT id, user_id, visibility FROM videos WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!video) throw new ApiError("NOT_FOUND", "Video not found", 404);
  if (video.visibility === "private" && video.user_id !== userId) {
    throw new ApiError("NOT_FOUND", "Video not found", 404);
  }

  // Owner's own views don't count.
  if (userId && video.user_id === userId) {
    return ok({ counted: false, reason: "owner" });
  }

  // Build a stable viewer hash from (userId or IP+UA).
  const ipHash = await clientIpHash(request, env.SESSION_SECRET || "dev");
  const ua = request.headers.get("User-Agent") || "";
  const uaHash = await hmacHex(env.SESSION_SECRET || "dev", ua.slice(0, 300));
  const viewerHash = userId
    ? `u:${userId}`
    : `a:${ipHash.slice(0, 24)}:${uaHash.slice(0, 8)}`;

  const cutoff = nowSec() - VIEW_COOLDOWN_SECONDS;

  const recent = await env.DB.prepare(
    `SELECT 1 AS x FROM video_views
      WHERE video_id = ? AND viewer_hash = ? AND viewed_at > ?
      LIMIT 1`
  )
    .bind(id, viewerHash, cutoff)
    .first();

  if (recent) return ok({ counted: false, reason: "cooldown" });

  const ts = nowSec();
  const viewId = newId("view");

  const stmts = [
    env.DB.prepare(
      `INSERT INTO video_views (id, video_id, user_id, viewer_hash, viewed_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(viewId, id, userId, viewerHash, ts),
    env.DB.prepare(`UPDATE videos SET views = views + 1 WHERE id = ?`).bind(id),
  ];

  await env.DB.batch(stmts);

  const updated = await env.DB.prepare(`SELECT views FROM videos WHERE id = ?`)
    .bind(id)
    .first();

  return ok({ counted: true, views: updated?.views || 0 });
}

/* ------------------------------------------------------------------ */
/* GET /api/search?q=&page=1&limit=24                                  */
/* ------------------------------------------------------------------ */

export async function search(request, env) {
  const url = new URL(request.url);
  const qRaw = sanitizeText(url.searchParams.get("q") || "", 100);
  const page = clamp(toInt(url.searchParams.get("page"), 1), 1, 10000);
  const limit = clamp(toInt(url.searchParams.get("limit"), 24), 1, 60);
  const offset = (page - 1) * limit;

  if (!qRaw) return ok({ videos: [], users: [], page, limit, total: 0 });

  const like = `%${qRaw.toLowerCase()}%`;

  const videos = await env.DB.prepare(
    `SELECT v.id, v.title, v.description, v.video_key, v.thumbnail_key,
            v.duration, v.views, v.visibility, v.created_at, v.updated_at,
            v.user_id, u.username, u.avatar_url
       FROM videos v
       JOIN users u ON u.id = v.user_id
      WHERE v.visibility = 'public' AND v.status = 'ready'
        AND (LOWER(v.title) LIKE ? OR LOWER(v.description) LIKE ?)
      ORDER BY v.views DESC, v.created_at DESC
      LIMIT ? OFFSET ?`
  )
    .bind(like, like, limit, offset)
    .all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM videos v
      WHERE v.visibility='public' AND v.status='ready'
        AND (LOWER(v.title) LIKE ? OR LOWER(v.description) LIKE ?)`
  )
    .bind(like, like)
    .first();

  const users = await env.DB.prepare(
    `SELECT id, username, avatar_url, bio, created_at
       FROM users
      WHERE LOWER(username) LIKE ?
      ORDER BY username ASC
      LIMIT 10`
  )
    .bind(like)
    .all();

  return ok({
    videos: (videos.results || []).map((r) => shapeVideo(env, r)),
    users: users.results || [],
    page,
    limit,
    total: total?.c || 0,
    query: qRaw,
  });
}
