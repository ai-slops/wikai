import { api } from "/api.js";

export function initializeReleaseBuild(options) {
  options.button.addEventListener("click", async () => {
    options.button.disabled = true;
    options.button.textContent = "Building…";
    try {
      await api.build();
      options.notify("Release build completed.");
      await options.onBuilt();
    } catch (error) {
      options.notify(error.message, true);
    } finally {
      options.button.disabled = false;
      options.button.textContent = "Build release";
    }
  });
}
