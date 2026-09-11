// worker/src/comments.js
// GET    /api/videos/:id/comments
// POST   /api/videos/:id/comments
// DELETE /api/comments/:id

import { requireUser, getSession } from "./auth.js";
import {
  ApiError,
  clamp,
  newId,
  ok,
  sanitizeText,
  toInt,
} from "./utils.js";

const MAX_COMMENT_LEN = 2000;

/* GET /api/videos/:id/comments?page=1&limit=30 */
export async function list(request, env, ctx, params) {
  const id = sanitizeText(params.id, 64);
  const url = new URL(request.url);
  const page = clamp(toInt(url.searchParams.get("page"), 1), 1, 10000);
  const limit = clamp(toInt(url.searchParams.get("limit"), 30), 1, 50);
  const offset = (page - 1) * limit;

  const video = await env.DB.prepare(`SELECT id, visibility, user_id FROM videos WHERE id = ?`)
    .bind(id)
    .first();
  if (!video) throw new ApiError("NOT_FOUND", "Video not found", 404);

  const rows = await env.DB.prepare(
    `SELECT c.id, c.text, c.created_at, c.user_id,
            u.username, u.avatar_url
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.video_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`
  )
    .bind(id, limit, offset)
    .all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM comments WHERE video_id = ?`
  )
    .bind(id)
    .first();

  return ok({
    comments: rows.results || [],
    page,
    limit,
    total: total?.c || 0,
  });
}

/* POST /api/videos/:id/comments */
export async function create(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  const video = await env.DB.prepare(`SELECT id, visibility, user_id FROM videos WHERE id = ?`)
    .bind(id)
    .first();
  if (!video) throw new ApiError("NOT_FOUND", "Video not found", 404);
  if (video.visibility === "private" && video.user_id !== me.id) {
    throw new ApiError("NOT_FOUND", "Video not found", 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }

  const text = sanitizeText(body.text, MAX_COMMENT_LEN);
  if (!text) throw new ApiError("EMPTY_COMMENT", "Comment text is required", 400);

  const cid = newId("cmt");
  await env.DB.prepare(
    `INSERT INTO comments (id, video_id, user_id, text) VALUES (?, ?, ?, ?)`
  )
    .bind(cid, id, me.id, text)
    .run();

  const row = await env.DB.prepare(
    `SELECT c.id, c.text, c.created_at, c.user_id, u.username, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.id = ?`
  )
    .bind(cid)
    .first();

  return ok({ comment: row }, 201);
}

/* DELETE /api/comments/:id */
export async function remove(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  const row = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.video_id, v.user_id AS video_owner
       FROM comments c
       JOIN videos v ON v.id = c.video_id
      WHERE c.id = ?`
  )
    .bind(id)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "Comment not found", 404);

  // Comment author OR video owner may delete.
  if (row.user_id !== me.id && row.video_owner !== me.id) {
    throw new ApiError("FORBIDDEN", "You cannot delete this comment", 403
