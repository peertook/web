// frontend/js/app.js
// Global UI: header rendering, theme, toast, helpers, card rendering.

const UI = (() => {
  const THEME_KEY = "peertook:theme";

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCount(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "K";
    if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  }

  function timeAgo(unixSec) {
    if (!unixSec) return "";
    const s = Math.floor(Date.now() / 1000) - Number(unixSec);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  function duration(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (x) => String(x).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /* ---------------- Theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    applyTheme(stored || (prefersDark ? "dark" : "light"));
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, cur);
    applyTheme(cur);
  }

  /* ---------------- Header ---------------- */

  async function renderHeader(activeUser) {
    const host = document.getElementById("app-header");
    if (!host) return;

    const user = activeUser !== undefined ? activeUser : Auth.current();
    const isAuth = !!user;

    host.innerHTML = `
      <header class="site-header" role="banner">
        <a class="brand" href="index.html" aria-label="Peertook home">
          <span class="brand-mark" aria-hidden="true">◉</span>
          <span class="brand-name">Peertook</span>
        </a>

        <form class="search-form" role="search" id="header-search">
          <label class="sr-only" for="header-search-input">Search Peertook</label>
          <input id="header-search-input" type="search" placeholder="Search videos and channels"
                 autocomplete="off" aria-label="Search" />
          <button type="submit" aria-label="Search">
            <span aria-hidden="true">🔎</span>
          </button>
        </form>

        <nav class="header-actions" aria-label="Account">
          <button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle theme">
            <span aria-hidden="true">◐</span>
          </button>
          ${
            isAuth
              ? `
            <a class="btn btn-ghost" href="upload.html">Upload</a>
            <div class="user-menu">
              <button class="user-btn" id="user-btn" type="button" aria-haspopup="true" aria-expanded="false">
                <img class="avatar avatar-sm" src="${escapeHtml(user.avatar_url || defaultAvatar(user.username))}" alt="" />
                <span class="user-name">${escapeHtml(user.username)}</span>
              </button>
              <div class="menu" id="user-menu-list" role="menu" hidden>
                <a role="menuitem" href="profile.html?username=${encodeURIComponent(user.username)}">My channel</a>
                <a role="menuitem" href="settings.html">Settings</a>
                <button role="menuitem" type="button" id="logout-btn">Sign out</button>
              </div>
            </div>`
              : `
            <a class="btn btn-ghost" href="login.html">Sign in</a>
            <a class="btn btn-primary" href="register.html">Create account</a>`
          }
        </nav>
      </header>
    `;

    // Search
    const form = document.getElementById("header-search");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("header-search-input").value.trim();
      if (q) location.href = `search.html?q=${encodeURIComponent(q)}`;
    });

    // Theme toggle
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

    // User menu
    if (isAuth) {
      const btn = document.getElementById("user-btn");
      const menu = document.getElementById("user-menu-list");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", () => {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      });
      document.getElementById("logout-btn").addEventListener("click", async () => {
        try {
          await Auth.logout();
        } catch {}
        location.href = "index.html";
      });
    }
  }

  /* ---------------- Video card ---------------- */

  function videoCard(v) {
    const href = `watch.html?id=${encodeURIComponent(v.id)}`;
    const thumb = v.thumbnail_url
      ? `<img loading="lazy" src="${escapeHtml(v.thumbnail_url)}" alt="" />`
      : `<div class="thumb-fallback" aria-hidden="true">▶</div>`;
    return `
      <a class="video-card" href="${href}">
        <div class="thumb">
          ${thumb}
          <span class="duration">${duration(v.duration)}</span>
        </div>
        <div class="meta">
          <img class="avatar avatar-sm" src="${escapeHtml(v.uploader?.avatar_url || defaultAvatar(v.uploader?.username || ""))}" alt="" loading="lazy" />
          <div class="meta-text">
            <h3 class="title">${escapeHtml(v.title)}</h3>
            <p class="uploader">${escapeHtml(v.uploader?.username || "")}</p>
            <p class="sub">${formatCount(v.views)} views · ${timeAgo(v.created_at)}</p>
          </div>
        </div>
      </a>
    `;
  }

  function skeletonCards(n = 8) {
    return Array.from({ length: n })
      .map(
        () => `
      <div class="video-card skeleton" aria-hidden="true">
        <div class="thumb"></div>
        <div class="meta">
          <div class="avatar avatar-sm"></div>
          <div class="meta-text">
            <div class="line"></div><div class="line short"></div>
          </div>
        </div>
      </div>`
      )
      .join("");
  }

  /* ---------------- Toast ---------------- */

  function toast(message, kind = "info", timeout = 3200) {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.setAttribute("role", "status");
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  /* ---------------- Empty state ---------------- */

  function emptyState(title, subtitle = "") {
    return `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true">◌</div>
        <h3>${escapeHtml(title)}</h3>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
    `;
  }

  function errorState(message) {
    return `
      <div class="empty-state error">
        <div class="empty-mark" aria-hidden="true">!</div>
        <h3>Something went wrong</h3>
        <p>${escapeHtml(message || "Please try again.")}</p>
      </div>
    `;
  }

  function defaultAvatar(seed) {
    const letter = (seed || "P").trim().charAt(0).toUpperCase() || "P";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="#3b82f6"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
            font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="28"
            fill="#fff">${letter.replace(/[<>&"]/g, "")}</text>
    </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function qsParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  return {
    escapeHtml,
    formatCount,
    timeAgo,
    duration,
    initTheme,
    toggleTheme,
    renderHeader,
    videoCard,
    skeletonCards,
    toast,
    emptyState,
    errorState,
    defaultAvatar,
    qsParam,
  };
})();

window.UI = UI;

document.addEventListener("DOMContentLoaded", async () => {
  UI.initTheme();
  try {
    await Auth.load();
  } catch {}
  await UI.renderHeader();
});
