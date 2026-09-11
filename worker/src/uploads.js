// worker/src/uploads.js
// Direct-to-R2 presigned upload flow.

import { requireUser } from "./auth.js";
import {
  ApiError,
  newId,
  nowSec,
  ok,
  sanitizeText,
  sha256Hex,
} from "./utils.js";

/* ------------------------------------------------------------------ */
/* Allowed media                                                       */
/* ------------------------------------------------------------------ */

const VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);
const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const EXT_FOR_MIME = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function safeFilename(name) {
  if (typeof name !== "string") return "file";
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned || "file";
}

/* ------------------------------------------------------------------ */
/* AWS SigV4 signing for R2 (S3-compatible API)                        */
/* ------------------------------------------------------------------ */

function enc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

async function hexHashHex(hex) {
  // hex string -> Uint8Array
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function signingKey(secret, date, region, service) {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  return kSigning;
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function presignPutUrl(env, key, contentType, expiresSec = 900) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.MEDIA_BUCKET_NAME; // name of the R2 bucket

  if (!accountId || !accessKey || !secretKey || !bucket) {
    throw new ApiError(
      "R2_NOT_CONFIGURED",
      "R2 credentials or bucket name missing in Worker secrets",
      500
    );
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${bucket}/${key.split("/").map(enc).join("/")}`;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "content-type;host",
  });

  // Sort query params canonically
  const sortedParams = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = sortedParams
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");

  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${host}\n`;
  const signedHeaders = "content-type;host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey(secretKey, dateStamp, region, service);
  const sigBytes = await hmac(key, stringToSign);
  const signature = bufToHex(sigBytes);

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, expiresAt: nowSec() + expiresSec };
}

/* ------------------------------------------------------------------ */
/* POST /api/uploads/presign                                           */
/* ------------------------------------------------------------------ */

export async function presign(request, env) {
  const me = await requireUser(env, request);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }

  const kind = body.kind === "thumbnail" ? "thumbnail" : "video";
  const filename = safeFilename(body.filename);
  const size = Number(body.size) || 0;
  const contentType = String(body.content_type || "").toLowerCase();

  if (!size || size <= 0) throw new ApiError("INVALID_SIZE", "File size required", 400);

  const max = parseInt(env.MAX_UPLOAD_SIZE || "0", 10) || 2 * 1024 * 1024 * 1024;
  const cap = kind === "thumbnail" ? 8 * 1024 * 1024 : max;
  if (size > cap) {
    throw new ApiError("FILE_TOO_LARGE", `File exceeds max size of ${cap} bytes`, 413);
  }

  const allowed = kind === "thumbnail" ? IMAGE_MIME : VIDEO_MIME;
  if (!allowed.has(contentType)) {
    throw new ApiError("INVALID_TYPE", `Unsupported ${kind} type: ${contentType}`, 415);
  }

  const ext = EXT_FOR_MIME[contentType] || "bin";
  const key = `${kind}s/${me.id}/${newId()}${filename ? "_" + filename.replace(/\.[^.]+$/, "") : ""}.${ext}`;

  const { url, expiresAt } = await presignPutUrl(env, key, contentType, 900);

  return ok({
    upload_url: url,
    key,
    expires_at: expiresAt,
    content_type: contentType,
  });
}

/* ------------------------------------------------------------------ */
/* POST /api/uploads/complete                                          */
/* ------------------------------------------------------------------ */

export async function complete(request, env) {
  const me = await requireUser(env, request);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_JSON", "Invalid JSON body", 400);
  }

  const videoKey = sanitizeText(body.video_key, 300);
  const thumbnailKey = body.thumbnail_key ? sanitizeText(body.thumbnail_key, 300) : null;
  const title = sanitizeText(body.title, 150);
  const description = sanitizeText(body.description, 5000);
  const duration = Math.max(0, Math.min(86400 * 24, parseInt(body.duration, 10) || 0));
  const visibility = ["public", "unlisted", "private"].includes(body.visibility)
    ? body.visibility
    : "public";

  if (!videoKey) throw new ApiError("MISSING_VIDEO_KEY", "video_key required", 400);
  if (!title) throw new ApiError("MISSING_TITLE", "Title is required", 400);

  // Ownership check: key prefix must include the caller's id.
  if (!videoKey.startsWith(`videos/${me.id}/`)) {
    throw new ApiError("FORBIDDEN", "Video key does not belong to you", 403);
  }
  if (thumbnailKey && !thumbnailKey.startsWith(`thumbnails/${me.id}/`)) {
    throw new ApiError("FORBIDDEN", "Thumbnail key does not belong to you", 403);
  }

  // Confirm the object exists in R2.
  const head = await env.MEDIA.head(videoKey);
  if (!head) {
    throw new ApiError("UPLOAD_NOT_FOUND", "Uploaded video not found in storage", 400);
  }

  const id = newId("vid");
  const ts = nowSec();

  await env.DB.prepare(
    `INSERT INTO videos
       (id, user_id, title, description, video_key, thumbnail_key,
        duration, views, visibility, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'ready', ?, ?)`
  )
    .bind(id, me.id, title, description, videoKey, thumbnailKey, duration, visibility, ts, ts)
    .run();

  const video = await env.DB.prepare(
    `SELECT id, title, description, video_key, thumbnail_key, duration,
            views, visibility, status, created_at
       FROM videos WHERE id = ?`
  )
    .bind(id)
    .first();

  return ok({ video }, 201);
}
