// frontend/js/search.js
// Search page.

(() => {
  const grid = document.getElementById("search-grid");
  if (!grid) return;

  const qInput = document.getElementById("page-q");
  const form = document.getElementById("page-search");
  const title = document.getElementById("search-title");
  const channelsSection = document.getElementById("channels-section");
  const channelList = document.getElementById("channel-list");
  const loadMore = document.getElementById("load-more");

  let q = UI.qsParam("q");
  let page = 1;
  const pageSize = 24;
  let total = 0;
  let loaded = 0;

  qInput.value = q;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const next = qInput.value.trim();
    if (!next) return;
    location.href = `search.html?q=${encodeURIComponent(next)}`;
  });

  async function run() {
    if (!q) {
      title.textContent = "Search Peertook";
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = UI.emptyState("Type something to search");
      return;
    }

    title.textContent = `Results for “${q}”`;
    grid.innerHTML = UI.skeletonCards(6);

    try {
      const res = await API.search(q, page);
      total = res.total;
      loaded += res.videos.length;

      grid.setAttribute("aria-busy", "false");
      if (page === 1) {
        grid.innerHTML = res.videos.length
          ? res.videos.map(UI.videoCard).join("")
          : UI.emptyState("No videos found", "Try a different query.");

        if (res.users && res.users.length) {
          channelsSection.hidden = false;
          channelList.innerHTML = res.users
            .map(
              (u) => `
              <a class="channel-chip" href="profile.html?username=${encodeURIComponent(u.username)}">
                <img class="avatar avatar-md" src="${UI.escapeHtml(u.avatar_url || UI.defaultAvatar(u.username))}" alt="" />
                <div>
                  <div class="chip-name">${UI.escapeHtml(u.username)}</div>
                  <div class="muted">${UI.escapeHtml((u.bio || "").slice(0, 60))}</div>
                </div>
              </a>`
            )
            .join("");
        } else {
          channelsSection.hidden = true;
        }
      } else {
        grid.insertAdjacentHTML("beforeend", res.videos.map(UI.videoCard).join(""));
      }

      loadMore.hidden = loaded >= total;
      if (!loadMore.hidden) {
        loadMore.onclick = () => {
          page += 1;
          run();
        };
      }
    } catch (err) {
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = UI.errorState(err.message);
    }
  }

  run();
})();
