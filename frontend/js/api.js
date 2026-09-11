// frontend/js/api.js
// Thin fetch wrapper with credentials + normalized error handling.

const API = (() => {
  function base() {
    if (!window.CONFIG || !window.CONFIG.API_BASE_URL) {
      throw new Error("API_BASE_URL is not configured");
    }
    return window.CONFIG.API_BASE_URL.replace(/\/+$/, "");
  }

  async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
    const opts = {
      method,
      credentials: "include",
      headers: { ...headers },
      signal,
    };
    if (body !== undefined) {
      if (body instanceof FormData) {
        opts.body = body;
      } else {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
    }

    let res;
    try {
      res = await fetch(base() + path, opts);
    } catch (err) {
      const e = new Error("Network error. Please check your connection.");
      e.code = "NETWORK";
      throw e;
    }

    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch { data = null; }
    }

    if (!res.ok || (data && data.success === false)) {
      const code = (data && data.error && data.error.code) || `HTTP_${res.status}`;
      const message =
        (data && data.error && data.error.message) ||
        res.statusText ||
        "Request failed";
      const e = new Error(message);
      e.code = code;
      e.status = res.status;
      throw e;
    }

    return data ? data.data : null;
  }

  return {
    get: (p, o) => request(p, { ...o, method: "GET" }),
    post: (p, body, o) => request(p, { ...o, method: "POST", body }),
    patch: (p, body, o) => request(p, { ...o, method: "PATCH", body }),
    del: (p, o) => request(p, { ...o, method: "DELETE" }),

    // Convenience
    getVideos: (params = {}) => request("/api/videos?" + qs(params)),
    getVideo: (id) => request(`/api/videos/${encodeURIComponent(id)}`),
    updateVideo: (id, body) => request(`/api/videos/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    deleteVideo: (id) => request(`/api/videos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    recordView: (id) => request(`/api/videos/${encodeURIComponent(id)}/view`, { method: "POST" }),
    like: (id) => request(`/api/videos/${encodeURIComponent(id)}/like`, { method: "POST" }),
    unlike: (id) => request(`/api/videos/${encodeURIComponent(id)}/like`, { method: "DELETE" }),
    comments: (id, page = 1) => request(`/api/videos/${encodeURIComponent(id)}/comments?page=${page}`),
    addComment: (id, text) => request(`/api/videos/${encodeURIComponent(id)}/comments`, { method: "POST", body: { text } }),
    deleteComment: (id) => request(`/api/comments/${encodeURIComponent(id)}`, { method: "DELETE" }),
    search: (q, page = 1) => request("/api/search?" + qs({ q, page })),
    me: () => request("/api/auth/me"),
    login: (body) => request("/api/auth/login", { method: "POST", body }),
    register: (body) => request("/api/auth/register", { method: "POST", body }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    getProfile: (username) => request(`/api/users/${encodeURIComponent(username)}`),
    updateMe: (body) => request("/api/users/me", { method: "PATCH", body }),
    getUserVideos: (username, page = 1) => request(`/api/users/${encodeURIComponent(username)}/videos?page=${page}`),
  };

  function qs(obj) {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }
})();

window.API = API;
