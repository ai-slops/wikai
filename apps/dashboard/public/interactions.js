export function selectReviewTab(button, loadPreview) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.setAttribute("aria-selected", String(tab === button));
    tab.tabIndex = tab === button ? 0 : -1;
  }
  const isDiff = button.id === "diff-tab";
  document.querySelector("#preview-panel").hidden = isDiff;
  document.querySelector("#diff-panel").hidden = !isDiff;
  if (!isDiff) {
    document.querySelector("#preview-panel").setAttribute("aria-labelledby", button.id);
    loadPreview(button.id === "approved-tab" ? "approved" : "working");
  }
}

export function initializeReviewTabKeyboard(loadPreview) {
  document.querySelector("#detail").addEventListener("keydown", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(tab);
    const destinations = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    const next = tabs[destination];
    selectReviewTab(next, loadPreview);
    next.focus();
  });
}

export function initializeSearchShortcut(showQueue) {
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.querySelector("dialog[open]") &&
      document.querySelector(".app-shell").dataset.mobileView === "detail"
    ) {
      showQueue();
      return;
    }
    if (event.key === "/" && !event.target.matches("input, textarea, select")) {
      event.preventDefault();
      showQueue();
    }
  });
}
