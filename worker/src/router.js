// worker/src/router.js
// Tiny pattern-matching router (no dependencies).

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const { regex, keys } = compile(pattern);
    routes.push({ method, regex, keys, handler });
  }

  return {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    patch: (p, h) => add("PATCH", p, h),
    delete: (p, h) => add("DELETE", p, h),
    options: (p, h) => add("OPTIONS", p, h),

    match(method, pathname) {
      const pathOnly = pathname.replace(/\/+$/, "") || "/";
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.regex.exec(pathOnly);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
      return null;
    },
  };
}

function compile(pattern) {
  const keys = [];
  const regexStr = pattern
    .replace(/\/+$/, "")
    .replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
      keys.push(key);
      return "/([^/]+)";
    });
  return { regex: new RegExp(`^${regexStr || "/"}$`), keys };
    }
