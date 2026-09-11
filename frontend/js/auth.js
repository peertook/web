// frontend/js/auth.js
// Small auth store used across pages.

const Auth = (() => {
  let cachedUser = null;
  let loaded = false;

  async function load() {
    try {
      const res = await API.me();
      cachedUser = res ? res.user : null;
    } catch {
      cachedUser = null;
    }
    loaded = true;
    return cachedUser;
  }

  function current() { return cachedUser; }
  function isLoaded() { return loaded; }

  async function login(body) {
    const res = await API.login(body);
    cachedUser = res.user;
    return cachedUser;
  }
  async function register(body) {
    const res = await API.register(body);
    cachedUser = res.user;
    return cachedUser;
  }
  async function logout() {
    await API.logout();
    cachedUser = null;
  }

  return { load, current, isLoaded, login, register, logout };
})();

window.Auth = Auth;
