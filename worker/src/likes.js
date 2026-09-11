// worker/src/likes.js
// POST /api/videos/:id/like     -> add
// DELETE /api/videos/:id/like   -> remove

import { requireUser } from "./auth.js";
import { ApiError, newId, ok, sanitizeText } from "./utils.js";

async function loadVideo(env, id) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, visibility FROM videos WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "Video not found", 404);
  return row;
}

async function likeCount(env, id) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM likes WHERE video_id = ?`)
    .bind(id)
    .first();
  return r?.c || 0;
}

/* POST /api/videos/:id/like */
export async function like(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  const video = await loadVideo(env, id);
  if (video.visibility === "private" && video.user_id !== me.id) {
    throw new ApiError("NOT_FOUND", "Video not found", 404);
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM likes WHERE video_id = ? AND user_id = ?`
  )
    .bind(id, me.id)
    .first();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO likes (id, video_id, user_id) VALUES (?, ?, ?)`
    )
      .bind(newId("like"), id, me.id)
      .run();
  }

  return ok({ liked: true, likes: await likeCount(env, id) });
}

/* DELETE /api/videos/:id/like */
export async function unlike(request, env, ctx, params) {
  const me = await requireUser(env, request);
  const id = sanitizeText(params.id, 64);

  await loadVideo(env, id);

  await env.DB.prepare(`DELETE FROM likes WHERE video_id = ? AND user_id = ?`)
    .bind(id, me.id)
    .run();

  return ok({ liked: false, likes: await likeCount(env, id) });
}
