// frontend/js/profile.js
// Channel page.

(() => {
  const header = document.getElementById("channel-header");
  if (!header) return;

  const username = UI.qsParam("username");
  const grid = document.getElementById("channel-grid");
  const loadMore = document.getElementById("load-more");

  if (!username) {
    header.setAttribute("aria-busy", "false");
    header.innerHTML = UI.errorState("No channel specified.");
    return;
  }

  let page = 1;
  const pageSize = 12;
  let total = 0;
  let loaded = 0;

  async function loadProfile() {
    try {
      const res = await API.getProfile(username);
      const me = Auth.current();
      const isMe = me && me.username.toLowerCase() === res.user.username.toLowerCase();

      document.title = `${res.user.username} · Peertook`;

      header.innerHTML = `
        <div class="channel-row">
          <img class="avatar avatar-xl" src="${UI.escapeHtml(res.user.avatar_url || UI.defaultAvatar(res.user.username))}" alt="" />
          <div class="channel-info">
            <h1 class="channel-name">${UI.escapeHtml(res.user.username)}</h1>
            <p class="sub">${UI.formatCount(res.stats.subscriber_count)} subscribers · ${UI.formatCount(res.stats.video_count)} videos · ${UI.formatCount(res.stats.total_views)} views</p>
            <p class="channel-bio">${UI.escapeHtml(res.user.bio || "")}</p>
            <p class="muted">Joined ${new Date(res.user.created_at * 1000).toLocaleDateString()}</p>
          </div>
          ${isMe ? `<a class="btn btn-ghost" href="settings.html">Edit channel</a>` : ""}
        </div>
      `;
      header.setAttribute("aria-busy", "false");
    } catch (err) {
      header.setAttribute("aria-busy", "false");
      header.innerHTML = UI.errorState(err.message);
    }
  }

  async function loadVideos() {
    try {
      const res = await API.getUserVideos(username, page);
      total = res.total;
      loaded += res.videos.length;

      if (page === 1) {
        grid.setAttribute("aria-busy", "false");
        grid.innerHTML = res.videos.length
          ? res.videos.map(UI.videoCard).join("")
          : UI.emptyState("No videos yet", "This channel hasn't posted anything.");
      } else {
        grid.insertAdjacentHTML("beforeend", res.videos.map(UI.videoCard).join(""));
      }

      loadMore.hidden = loaded >= total;
      if (!loadMore.hidden) {
        loadMore.onclick = () => {
          page += 1;
          loadVideos();
        };
      }
    } catch (err) {
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = UI.errorState(err.message);
    }
  }

  (async () => {
    header.innerHTML = `<div class="channel-row skeleton"><div class="avatar avatar-xl"></div><div><div class="line tall"></div><div class="line"></div></div></div>`;
    grid.innerHTML = UI.skeletonCards(6);
    await loadProfile();
    await loadVideos();
  })();
})();
