// worker/src/index.js
// Peertook Worker entry point.

import { createRouter } from "./router.js";
import {
  ApiError,
  corsHeaders,
  fail,
  ok,
  withCors,
} from "./utils.js";
import * as authRoutes from "./auth-routes.js";
import * as usersRoutes from "./users.js";
import * as videosRoutes from "./videos.js";
import * as commentsRoutes from "./comments.js";
import * as likesRoutes from "./likes.js";
import * as uploadsRoutes from "./uploads.js";

const router = createRouter();

/* ---------------- Health ---------------- */
router.get("/api/health", async () => ok({ status: "ok", time: Date.now() }));

/* ---------------- Auth ---------------- */
router.post("/api/auth/register", authRoutes.register);
router.post("/api/auth/login", authRoutes.login);
router.post("/api/auth/logout", authRoutes.logout);
router.get("/api/auth/me", authRoutes.me);

/* ---------------- Users ---------------- */
router.get("/api/users/:username", usersRoutes.getProfile);
router.patch("/api/users/me", usersRoutes.updateMe);
router.get("/api/users/:username/videos", usersRoutes.getUserVideos);

/* ---------------- Videos ---------------- */
router.get("/api/videos", videosRoutes.list);
router.get("/api/videos/:id", videosRoutes.getOne);
router.patch("/api/videos/:id", videosRoutes.update);
router.delete("/api/videos/:id", videosRoutes.remove);
router.post("/api/videos/:id/view", videosRoutes.recordView);

/* ---------------- Likes ---------------- */
router.post("/api/videos/:id/like", likesRoutes.like);
router.delete("/api/videos/:id/like", likesRoutes.unlike);

/* ---------------- Comments ---------------- */
router.get("/api/videos/:id/comments", commentsRoutes.list);
router.post("/api/videos/:id/comments", commentsRoutes.create);
router.delete("/api/comments/:id", commentsRoutes.remove);

/* ---------------- Uploads ---------------- */
router.post("/api/uploads/presign", uploadsRoutes.presign);
router.post("/api/uploads/complete", uploadsRoutes.complete);

/* ---------------- Search ---------------- */
router.get("/api/search", videosRoutes.search);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGINS || "";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    try {
      const match = router.match(request.method, url.pathname);
      if (!match) {
        return withCors(
          fail("NOT_FOUND", "Endpoint not found", 404),
          origin,
          allowed
        );
      }
      const resp = await match.handler(request, env, ctx, match.params);
      return withCors(resp, origin, allowed);
    } catch (err) {
      if (err instanceof ApiError) {
        return withCors(fail(err.code, err.message, err.status), origin, allowed);
      }
      console.error("Unhandled error:", err && err.stack ? err.stack : err);
      return withCors(
        fail("INTERNAL_ERROR", "Internal server error", 500),
        origin,
        allowed
      );
    }
  },
};
