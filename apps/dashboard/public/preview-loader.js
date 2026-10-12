export function createPreviewLoader(getSelectedId, requestPreview, notify) {
  let previewVersion = 0;

  function renderPreview(frame, html) {
    return new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.srcdoc = html;
    });
  }

  return async function loadPreview(mode) {
    const version = ++previewVersion;
    const publicId = getSelectedId();
    if (!publicId) return;
    const frame = document.querySelector("#preview-frame");
    if (!frame) return;
    frame.dataset.mode = mode;
    const isCurrent = () =>
      version === previewVersion &&
      getSelectedId() === publicId &&
      frame.isConnected &&
      frame.dataset.mode === mode;
    frame.setAttribute("aria-busy", "true");
    try {
      const preview = await requestPreview(mode, publicId);
      if (!isCurrent()) return;
      frame.title = `Sandboxed public ${mode} preview`;
      await renderPreview(frame, preview.html || "<p>Preview is empty.</p>");
    } catch (error) {
      if (!isCurrent()) return;
      await renderPreview(
        frame,
        `<p>${mode === "approved" ? "No approved preview is available." : "Preview failed to load."}</p>`,
      );
      if (mode === "working") notify(error.message, true);
    } finally {
      if (isCurrent()) frame.removeAttribute("aria-busy");
    }
  };
}
