import { api, initializeSession } from "/api.js";
import { initializeAssetInspection } from "/asset-inspection.js";
import {
  initializeReviewTabKeyboard,
  initializeSearchShortcut,
  selectReviewTab,
} from "/interactions.js";
import { initializeManagement } from "/management.js";
import { initializeMetadataEditor } from "/metadata.js";
import { createToast } from "/notifications.js";
import { createPreviewLoader } from "/preview-loader.js";
import { initializeReleaseBuild } from "/release.js";
import {
  publicationDiagnostics,
  renderDetail,
  renderDiagnosticRail,
  renderQueue,
  renderSummary,
  renderUnavailableDetail,
} from "/render.js";
import { initializeSourceReview } from "/source-review.js";
import { initializeWorkflow } from "/workflow.js";

const elements = {
  shell: document.querySelector(".app-shell"),
  queue: document.querySelector("#queue"),
  list: document.querySelector("#queue-list"),
  count: document.querySelector("#queue-count"),
  search: document.querySelector("#search"),
  state: document.querySelector("#state-filter"),
  kind: document.querySelector("#kind-filter"),
  detail: document.querySelector("#detail"),
  empty: document.querySelector("#empty-state"),
  summary: document.querySelector("#summary"),
  diagnosticRail: document.querySelector("#diagnostic-rail"),
  confirm: document.querySelector("#confirm-dialog"),
  confirmCopy: document.querySelector("#confirm-copy"),
  confirmAction: document.querySelector("#confirm-action"),
  redirectField: document.querySelector("#redirect-field"),
  redirect: document.querySelector("#redirect-input"),
  toast: document.querySelector("#toast"),
  build: document.querySelector("#build-button"),
  queueToggle: document.querySelector("#queue-toggle"),
  newButton: document.querySelector("#new-button"),
  inspectButton: document.querySelector("#inspect-button"),
};

const state = {
  publications: [],
  diagnostics: [],
  selectedId: "",
  detail: null,
  pendingAction: null,
  tagFilterIds: null,
};
let selectionVersion = 0;
const toast = createToast(elements.toast);
const loadPreview = createPreviewLoader(() => state.selectedId, api.preview, toast);

function filteredPublications() {
  const query = elements.search.value.trim().toLowerCase();
  return state.publications.filter((row) => {
    const searchable = [row.title, row.slug, row.publicId].filter(Boolean).join(" ").toLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (!elements.state.value || row.status === elements.state.value) &&
      (!elements.kind.value || row.kind === elements.kind.value) &&
      (state.tagFilterIds === null || state.tagFilterIds.has(row.publicId))
    );
  });
}

function refreshQueue() {
  const filtered = filteredPublications();
  renderQueue(elements.list, filtered, state.selectedId);
  elements.count.textContent = `${filtered.length} / ${state.publications.length}`;
  elements.list.setAttribute("aria-busy", "false");
}

function updateStateOptions() {
  const current = elements.state.value;
  const states = [...new Set(state.publications.map((row) => row.status).filter(Boolean))].sort();
  elements.state.innerHTML = '<option value="">All states</option>';
  for (const value of states) elements.state.add(new Option(value, value));
  elements.state.value = current;
}

async function loadStatus() {
  const result = await api.status();
  state.publications = Array.isArray(result.publications) ? result.publications : [];
  state.diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  updateStateOptions();
  refreshQueue();
  renderSummary(elements.summary, state.publications);
  if (!state.selectedId) renderDiagnosticRail(elements.diagnosticRail, state.diagnostics);
}

async function selectPublication(publicId) {
  const version = ++selectionVersion;
  state.selectedId = publicId;
  refreshQueue();
  elements.detail.hidden = false;
  elements.empty.hidden = true;
  elements.detail.setAttribute("aria-busy", "true");
  try {
    const detail = await api.detail(publicId);
    if (version !== selectionVersion) return;
    state.detail = detail;
    const row = state.publications.find((item) => item.publicId === publicId);
    renderDetail(elements.detail, detail, row);
    renderDiagnosticRail(elements.diagnosticRail, publicationDiagnostics(detail, row));
    if (detail.working) await loadPreview("working");
    if (version !== selectionVersion) return;
    elements.shell.dataset.mobileView = "detail";
    elements.queueToggle.setAttribute("aria-expanded", "false");
    elements.detail.focus();
  } catch (error) {
    if (version !== selectionVersion) return;
    const row = state.publications.find((item) => item.publicId === publicId);
    if (row?.status === "blocked" || row?.status === "source-drift") {
      renderUnavailableDetail(elements.detail, row);
      renderDiagnosticRail(elements.diagnosticRail, row.diagnostics || []);
      elements.shell.dataset.mobileView = "detail";
      elements.detail.focus();
    } else toast(error.message, true);
  } finally {
    if (version === selectionVersion) elements.detail.removeAttribute("aria-busy");
  }
}

function showQueue() {
  elements.shell.dataset.mobileView = "queue";
  elements.queueToggle.setAttribute("aria-expanded", "true");
  elements.search.focus();
}

function askConfirmation(action) {
  const working = state.detail?.working;
  const approved = state.detail?.approved;
  const isWithdraw = action === "withdraw";
  const hash = isWithdraw ? approved?.exposureHash : working?.exposureHash;
  if (!hash) return;
  state.pendingAction = { action, hash };
  elements.confirmCopy.textContent = isWithdraw
    ? `Withdraw approved revision ${hash}? The source remains private and unchanged, but withdrawal cannot erase copies already saved by readers, caches, or archives.`
    : `Approve exact exposure hash ${hash}? Only this immutable public revision can enter release staging.`;
  elements.confirmAction.textContent = isWithdraw ? "Withdraw revision" : "Approve revision";
  elements.confirmAction.className = isWithdraw ? "button button--danger" : "button button--ink";
  elements.redirectField.hidden = !isWithdraw;
  elements.confirm.showModal();
}

async function confirmAction(event) {
  if (event.target.returnValue !== "confirm" || !state.pendingAction) return;
  try {
    if (state.pendingAction.action === "withdraw")
      await api.withdraw(
        state.selectedId,
        state.pendingAction.hash,
        elements.redirect.value.trim(),
      );
    else await api.approve(state.selectedId, state.pendingAction.hash);
    toast(
      state.pendingAction.action === "withdraw"
        ? "Revision withdrawn."
        : "Exact revision approved.",
    );
    await loadStatus();
    await selectPublication(state.selectedId);
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.pendingAction = null;
    elements.redirect.value = "";
  }
}

async function handleDetailClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "back-button") showQueue();
  else if (button.id === "approve-button") askConfirmation("approve");
  else if (button.id === "withdraw-button") askConfirmation("withdraw");
  else if (button.id === "metadata-button") {
    metadataEditor.open(state.detail);
  } else if (button.matches('[role="tab"]')) selectReviewTab(button, loadPreview);
  else if (button.matches(".restore-button")) {
    try {
      const expectedHash =
        state.detail.approved?.exposureHash || state.detail.history?.at(-1)?.exposureHash;
      if (!expectedHash) return;
      await api.restore(state.selectedId, button.dataset.revisionHash, expectedHash);
      toast("Historical approved revision activated.");
      await loadStatus();
      await selectPublication(state.selectedId);
    } catch (error) {
      toast(error.message, true);
    }
  }
}

elements.list.addEventListener("click", (event) => {
  const row = event.target.closest("[data-public-id]");
  if (row) selectPublication(row.dataset.publicId);
});
elements.search.addEventListener("input", refreshQueue);
elements.state.addEventListener("change", refreshQueue);
elements.kind.addEventListener("change", refreshQueue);
elements.detail.addEventListener("click", handleDetailClick);
elements.confirm.addEventListener("close", confirmAction);
elements.newButton.addEventListener("click", () => workflowEditor.open());
elements.inspectButton.addEventListener("click", () => assetInspection.open());
elements.queueToggle.addEventListener("click", showQueue);
initializeSearchShortcut(showQueue);
initializeReviewTabKeyboard(loadPreview);

elements.shell.dataset.mobileView = "queue";
const metadataEditor = initializeMetadataEditor({
  notify: toast,
  onSaved: async () => {
    await loadStatus();
    await selectPublication(state.selectedId);
  },
});
const workflowEditor = initializeWorkflow({
  onCreated: loadStatus,
  notify: toast,
});
const assetInspection = initializeAssetInspection({ notify: toast });
initializeManagement({
  notify: toast,
  onApplied: loadStatus,
  onFilter: (documents) => {
    state.tagFilterIds =
      documents === null ? null : new Set(documents.map((item) => item.publicId));
    refreshQueue();
  },
});
initializeReleaseBuild({ button: elements.build, notify: toast, onBuilt: loadStatus });
initializeSourceReview({
  selection: () => ({ id: state.selectedId, version: selectionVersion }),
  isCurrent: (selection) =>
    selection.id === state.selectedId && selection.version === selectionVersion,
  notify: toast,
  onApplied: async () => {
    const publicId = state.selectedId;
    await loadStatus();
    await selectPublication(publicId);
  },
});
try {
  await initializeSession();
  await loadStatus();
} catch (error) {
  elements.list.setAttribute("aria-busy", "false");
  elements.list.innerHTML =
    '<div class="empty-state"><span class="kicker">Connection error</span><h2>The publication service is unavailable.</h2><p>Check the configured vault and reload this page.</p></div>';
  toast(error.message, true);
}
