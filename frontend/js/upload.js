// frontend/js/upload.js
// Handles direct-to-R2 uploads using presigned URLs from the Worker.

(() => {
  const form = document.getElementById("upload-form");
  if (!form) return;

  const videoInput = document.getElementById("video-file");
  const thumbInput = document.getElementById("thumb-file");
  const videoChosen = document.getElementById("video-chosen");
  const thumbChosen = document.getElementById("thumb-chosen");
  const progress = document.getElementById("progress");
  const errEl = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");

  let videoFile = null;
  let thumbFile = null;

  const MAX_VIDEO = 2 * 1024 * 1024 * 1024;
  const MAX_THUMB = 8 * 1024 * 1024;
  const VIDEO_MIME = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
  const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  function setError(msg) {
    errEl.textContent = msg || "";
    errEl.hidden = !msg;
  }

  videoInput.addEventListener("change", () => {
    const f = videoInput.files[0];
    setError("");
    if (!f) { videoChosen.textContent = ""; videoFile = null; return; }
    if (!VIDEO_MIME.includes(f.type)) { setError("Unsupported video format."); videoFile = null; videoChosen.textContent = ""; return; }
    if (f.size > MAX_VIDEO) { setError("Video exceeds 2 GB."); videoFile = null; videoChosen.textContent = ""; return; }
    videoFile = f;
    videoChosen.textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
  });

  thumbInput.addEventListener("change", () => {
    const f = thumbInput.files[0];
    setError("");
    if (!f) { thumbChosen.textContent = ""; thumbFile = null; return; }
    if (!IMAGE_MIME.includes(f.type)) { setError("Unsupported image format."); thumbFile = null; thumbChosen.textContent = ""; return; }
    if (f.size > MAX_THUMB) { setError("Thumbnail exceeds 8 MB."); thumbFile = null; thumbChosen.textContent = ""; return; }
    thumbFile = f;
    thumbChosen.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
  });

  async function uploadToPresigned(url, file, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  async function getDuration(file) {
    return new Promise((resolve) => {
      try {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(Math.round(v.duration) || 0); };
        v.onerror = () => resolve(0);
        v.src = URL.createObjectURL(file);
      } catch { resolve(0); }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");

    const title = document.getElementById("title").value.trim();
    if (!title) { setError("Title is required."); return; }
    if (!videoFile) { setError("Please select a video file."); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Preparing…";
    progress.hidden = false;
    progress.value = 0;

    try {
      // 1) Presign video
      const vp = await API.post("/api/uploads/presign", {
        kind: "video",
        filename: videoFile.name,
        size: videoFile.size,
        content_type: videoFile.type,
      });

      // 2) Upload video
      submitBtn.textContent = "Uploading video…";
      await uploadToPresigned(vp.upload_url, videoFile, vp.content_type, (p) => {
        progress.value = Math.round(p * 90);
      });

      // 3) Optional thumbnail
      let thumbKey = null;
      if (thumbFile) {
        submitBtn.textContent = "Uploading thumbnail…";
        const tp = await API.post("/api/uploads/presign", {
          kind: "thumbnail",
          filename: thumbFile.name,
          size: thumbFile.size,
          content_type: thumbFile.type,
        });
        await uploadToPresigned(tp.upload_url, thumbFile, tp.content_type, (p) => {
          progress.value = 90 + Math.round(p * 8);
        });
        thumbKey = tp.key;
      }

      // 4) Duration
      const duration = await getDuration(videoFile);

      // 5) Complete
      submitBtn.textContent = "Finalizing…";
      const res = await API.post("/api/uploads/complete", {
        video_key: vp.key,
        thumbnail_key: thumbKey,
        title,
        description: document.getElementById("description").value,
        visibility: document.getElementById("visibility").value,
        duration,
      });

      progress.value = 100;
      UI.toast("Video published!", "success");
      location.href = `watch.html?id=${encodeURIComponent(res.video.id)}`;
    } catch (err) {
      setError(err.message || "Upload failed.");
      UI.toast(err.message || "Upload failed.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Publish";
    }
  });
})();
