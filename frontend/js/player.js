// frontend/js/player.js
// Watch page: custom HTML5 player, likes, comments, related videos.

(() => {
  const host = document.getElementById("watch-main");
  if (!host) return;

  const relatedList = document.getElementById("related-list");
  const videoId = UI.qsParam("id");

  if (!videoId) {
    host.setAttribute("aria-busy", "false");
    host.innerHTML = UI.errorState("Missing video id.");
    return;
  }

  const state = {
    video: null,
    liked: false,
    likes: 0,
    commentPage: 1,
    commentsLoaded: 0,
    commentsTotal: 0,
  };

  /* ---------------- Render shell ---------------- */

  function renderShell(v) {
    const u = v.uploader || {};
    const isOwner = Auth.current() && Auth.current().id === u.id;

    host.innerHTML = `
      <div class="player-wrap">
        <video id="video-el" class="player" controls playsinline preload="metadata"
               poster="${v.thumbnail_url ? UI.escapeHtml(v.thumbnail_url) : ""}">
          <source src="${UI.escapeHtml(v.video_url || "")}" />
          Your browser does not support the video tag.
        </video>
      </div>

      <div class="video-head">
        <h1 id="video-title">${UI.escapeHtml(v.title)}</h1>

        <div class="video-actions">
          <div class="uploader-block">
            <a class="uploader-link" href="profile.html?username=${encodeURIComponent(u.username || "")}">
              <img class="avatar avatar-md" src="${UI.escapeHtml(u.avatar_url || UI.defaultAvatar(u.username))}" alt="" />
              <div>
                <div class="uploader-name">${UI.escapeHtml(u.username || "")}</div>
                <div class="sub">${UI.formatCount(v.views)} views · ${UI.timeAgo(v.created_at)}</div>
              </div>
            </a>
          </div>

          <div class="action-buttons">
            <button class="btn btn-ghost like-btn" id="like-btn" type="button" aria-pressed="false">
              <span aria-hidden="true">♥</span>
              <span id="like-count">0</span>
            </button>
            ${isOwner ? `
              <button class="btn btn-ghost danger" id="delete-btn" type="button">Delete</button>
            ` : ""}
          </div>
        </div>

        <details class="description">
          <summary>Description</summary>
          <p>${linkify(v.description || "")}</p>
        </details>
      </div>

      <section class="comments" aria-labelledby="comments-title">
        <h2 id="comments-title" class="side-title">Comments <span class="muted" id="comments-count"></span></h2>

        <form class="comment-form" id="comment-form" hidden>
          <label class="sr-only" for="comment-input">Add a comment</label>
          <textarea id="comment-input" rows="3" maxlength="2000" placeholder="Add a comment…"></textarea>
          <div class="comment-actions">
            <button class="btn btn-primary" type="submit">Post</button>
          </div>
        </form>
        <p class="signin-hint" id="signin-hint" hidden>
          <a href="login.html?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a> to comment.
        </p>

        <div class="comment-list" id="comment-list"></div>
        <div class="load-more-wrap">
          <button class="btn btn-ghost" id="load-more-comments" type="button" hidden>Load more comments</button>
        </div>
      </section>
    `;

    // Custom player enhancements
    enhancePlayer(document.getElementById("video-el"));

    // Like button
    const likeBtn = document.getElementById("like-btn");
    likeBtn.addEventListener("click", onToggleLike);

    // Delete
    const del = document.getElementById("delete-btn");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm("Delete this video permanently?")) return;
        try {
          await API.deleteVideo(v.id);
          UI.toast("Video deleted", "success");
          location.href = "index.html";
        } catch (err) {
          UI.toast(err.message, "error");
        }
      });
    }

    // Comment form
    const cf = document.getElementById("comment-form");
    const hint = document.getElementById("signin-hint");
    if (Auth.current()) cf.hidden = false;
    else hint.hidden = false;

    cf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("comment-input");
      const text = input.value.trim();
      if (!text) return;
      try {
        const res = await API.addComment(v.id, text);
        input.value = "";
        state.commentsTotal += 1;
        document.getElementById("comments-count").textContent = `(${state.commentsTotal})`;
        const list = document.getElementById("comment-list");
        list.insertAdjacentHTML("afterbegin", commentItem(res.comment));
        bindCommentActions();
        UI.toast("Comment posted", "success");
      } catch (err) {
        UI.toast(err.message, "error");
      }
    });
  }

  function linkify(text) {
    const escaped = UI.escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s]+)/g, (m) =>
      `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
    );
  }

  /* ---------------- Custom player ---------------- */

  function enhancePlayer(video) {
    if (!video) return;

    // Playback speed menu
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    const wrap = document.createElement("div");
    wrap.className = "player-extras";
    wrap.innerHTML = `
      <label class="speed-wrap">
        <span class="sr-only">Playback speed</span>
        <select id="speed-select" class="speed-select">
          ${speeds.map((s) => `<option value="${s}" ${s === 1 ? "selected" : ""}>${s}×</option>`).join("")}
        </select>
      </label>
    `;
    video.parentElement.appendChild(wrap);

    wrap.querySelector("#speed-select").addEventListener("change", (e) => {
      video.playbackRate = Number(e.target.value);
    });
  }

  /* ---------------- Comments ---------------- */

  function commentItem(c) {
    const me = Auth.current();
    const canDelete = me && (me.id === c.user_id);
    return `
      <article class="comment" data-id="${UI.escapeHtml(c.id)}">
        <img class="avatar avatar-sm" src="${UI.escapeHtml(c.avatar_url || UI.defaultAvatar(c.username))}" alt="" />
        <div class="comment-body">
          <div class="comment-head">
            <a class="comment-author" href="profile.html?username=${encodeURIComponent(c.username)}">${UI.escapeHtml(c.username)}</a>
            <span class="muted">· ${UI.timeAgo(c.created_at)}</span>
          </div>
          <p class="comment-text">${UI.escapeHtml(c.text)}</p>
          ${canDelete ? `<button class="link-danger" data-delete="${UI.escapeHtml(c.id)}">Delete</button>` : ""}
        </div>
      </article>
    `;
  }

  function bindCommentActions() {
    document.querySelectorAll("[data-delete]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-delete");
        if (!confirm("Delete this comment?")) return;
        try {
          await API.deleteComment(id);
          btn.closest(".comment")?.remove();
          state.commentsTotal = Math.max(0, state.commentsTotal - 1);
          document.getElementById("comments-count").textContent = `(${state.commentsTotal})`;
          UI.toast("Comment deleted", "success");
        } catch (err) {
          UI.toast(err.message, "error");
        }
      });
    });
  }

  async function loadComments() {
    const list = document.getElementById("comment-list");
    const loadMore = document.getElementById("load-more-comments");
    try {
      const res = await API.comments(videoId, state.commentPage);
      state.commentsTotal = res.total;
      state.commentsLoaded += res.comments.length;
      document.getElementById("comments-count").textContent = `(${res.total})`;

      if (state.commentPage === 1) {
        list.innerHTML = res.comments.length
          ? res.comments.map(commentItem).join("")
          : UI.emptyState("No comments yet", "Be the first to comment.");
        bindCommentActions();
      } else {
        list.insertAdjacentHTML("beforeend", res.comments.map(commentItem).join(""));
        bindCommentActions();
      }

      loadMore.hidden = state.commentsLoaded >= res.total;
      if (!loadMore.hidden) {
        loadMore.onclick = () => {
          state.commentPage += 1;
          loadComments();
        };
      }
    } catch (err) {
      list.innerHTML = UI.errorState(err.message);
    }
  }

  /* ---------------- Likes ---------------- */

  async function onToggleLike() {
    if (!Auth.current()) {
      UI.toast("Sign in to like videos", "info");
      location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    const btn = document.getElementById("like-btn");
    const countEl = document.getElementById("like-count");
    btn.disabled = true;
    try {
      const res = state.liked ? await API.unlike(videoId) : await API.like(videoId);
      state.liked = res.liked;
      state.likes = res.likes;
      countEl.textContent = UI.formatCount(res.likes);
      btn.setAttribute("aria-pressed", String(state.liked));
      btn.classList.toggle("active", state.liked);
    } catch (err) {
      UI.toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- Related ---------------- */

  async function loadRelated() {
    try {
      const res = await API.getVideos({ sort: "trending", limit: 10 });
      const items = res.videos.filter((v) => v.id !== videoId).slice(0, 8);
      relatedList.setAttribute("aria-busy", "false");
      relatedList.innerHTML = items.length
        ? items
            .map(
              (v) => `
          <a class="related-item" href="watch.html?id=${encodeURIComponent(v.id)}">
            <div class="rel-thumb">
              ${v.thumbnail_url ? `<img src="${UI.escapeHtml(v.thumbnail_url)}" alt="" loading="lazy" />` : `<div class="thumb-fallback" aria-hidden="true">▶</div>`}
              <span class="duration">${UI.duration(v.duration)}</span>
            </div>
            <div class="rel-meta">
              <h3>${UI.escapeHtml(v.title)}</h3>
              <p class="muted">${UI.escapeHtml(v.uploader?.username || "")}</p>
              <p class="muted">${UI.formatCount(v.views)} views · ${UI.timeAgo(v.created_at)}</p>
            </div>
          </a>`
            )
            .join("")
        : UI.emptyState("Nothing else to watch yet");
    } catch (err) {
      relatedList.innerHTML = UI.errorState(err.message);
    }
  }

  /* ---------------- Boot ---------------- */

  (async () => {
    // Skeleton
    host.innerHTML = `
      <div class="player-wrap skeleton-player" aria-hidden="true"></div>
      <div class="video-head">
        <div class="line tall"></div><div class="line"></div><div class="line short"></div>
      </div>`;

    try {
      const res = await API.getVideo(videoId);
      state.video = res.video;
      state.liked = !!res.liked;
      state.likes = res.likes || 0;
      host.setAttribute("aria-busy", "false");
      document.title = `${res.video.title} · Peertook`;
      renderShell(res.video);
      document.getElementById("like-count").textContent = UI.formatCount(state.likes);
      const likeBtn = document.getElementById("like-btn");
      if (state.liked) {
        likeBtn.classList.add("active");
        likeBtn.setAttribute("aria-pressed", "true");
      }

      // Non-owner view counting (server also enforces)
      const me = Auth.current();
      if (!me || me.id !== res.video.uploader?.id) {
        API.recordView(videoId).catch(() => {});
      }

      loadComments();
      loadRelated();
    } catch (err) {
      host.setAttribute("aria-busy", "false");
      host.innerHTML = UI.errorState(err.message);
      document.getElementById("related-list").innerHTML = "";
    }
  })();
})();
