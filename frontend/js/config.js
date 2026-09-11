// frontend/js/config.js
// Public configuration only. NEVER put secrets here.

const CONFIG = {
  // Replace with your deployed Worker URL (no trailing slash).
  API_BASE_URL: "https://REPLACE-WITH-YOUR-WORKER.workers.dev",
  SITE_NAME: "Peertook",
  // R2 public base is returned by the API inside video objects; no need to duplicate here.
  DEFAULT_PAGE_SIZE: 24,
};

window.CONFIG = CONFIG;
