import { api } from "/api.js";
import { inspectionMessage } from "/inspection-format.js";

function addDefinition(list, label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = String(value ?? "Unavailable");
  wrapper.append(term, description);
  list.append(wrapper);
}

function addTextList(container, heading, values, emptyCopy) {
  const section = document.createElement("div");
  section.className =
    heading === "Reference documents" ? "inspection-references" : "inspection-notes";
  const title = document.createElement("h3");
  title.textContent = heading;
  const list = document.createElement("ul");
  const entries = values.length > 0 ? values : [emptyCopy];
  for (const value of entries) {
    const item = document.createElement("li");
    item.textContent = inspectionMessage(value);
    list.append(item);
  }
  section.append(title, list);
  container.append(section);
}

function renderReport(container, report) {
  const summary = document.createElement("dl");
  summary.className = "inspection-summary";
  addDefinition(summary, "Vault path", report.sourcePath);
  addDefinition(summary, "Original name", report.originalName);
  addDefinition(summary, "Prospective public path", report.prospectivePublicPath);
  addDefinition(summary, "Exact SHA-256", report.sha256);
  addDefinition(summary, "Bytes", report.bytes);
  addDefinition(summary, "Detected MIME", report.detectedMime);
  addDefinition(summary, "Inside public assets", report.underPublicAssets ? "Yes" : "No");
  addDefinition(summary, "Current hash reviewed", report.hashReviewed ? "Yes" : "No");
  addDefinition(summary, "Reference inventory complete", report.referencesComplete ? "Yes" : "No");
  addDefinition(
    summary,
    "Inspection support",
    report.inspection?.ok ? "Supported" : (report.inspection?.code ?? "Unsupported"),
  );
  container.replaceChildren(summary);
  const references = Array.isArray(report.referringCandidateDocuments)
    ? report.referringCandidateDocuments.map(
        (reference) =>
          `${reference.publicId ?? "Unknown publication"} · ${reference.sourcePath ?? "Unknown path"}`,
      )
    : [];
  addTextList(container, "Reference documents", references, "No candidate references found.");
  const blockers = Array.isArray(report.reviewBlockers) ? report.reviewBlockers : [];
  const notes =
    report.inspection?.ok && Array.isArray(report.inspection.notes) ? report.inspection.notes : [];
  addTextList(
    container,
    "Review blockers and notes",
    [...blockers, ...notes],
    "No notes reported.",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Complete metadata report";
  heading.className = "inspection-notes";
  const raw = document.createElement("pre");
  raw.className = "raw-report";
  raw.textContent = JSON.stringify(report, null, 2);
  container.append(heading, raw);
}

export function initializeAssetInspection(options) {
  const dialog = document.querySelector("#inspection-dialog");
  const form = document.querySelector("#inspection-form");
  const state = document.querySelector("#inspection-state");
  const report = document.querySelector("#inspection-report");
  const submit = document.querySelector("#inspection-submit");
  let requestVersion = 0;

  function close() {
    requestVersion += 1;
    dialog.close();
  }

  document.querySelector("#inspection-close").addEventListener("click", close);
  document.querySelector("#inspection-cancel").addEventListener("click", close);
  dialog.addEventListener("close", () => {
    requestVersion += 1;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const version = ++requestVersion;
    const path = String(new FormData(form).get("path") ?? "").trim();
    submit.disabled = true;
    state.dataset.state = "loading";
    state.textContent = "Inspecting bounded metadata…";
    report.hidden = true;
    try {
      const result = await api.inspectAsset(path);
      if (version !== requestVersion) return;
      renderReport(report, result);
      report.hidden = false;
      const complete = result.referencesComplete && result.inspection?.ok;
      state.dataset.state = complete ? "complete" : "warning";
      state.textContent = complete
        ? "Inspection complete. No review or approval state changed."
        : "Inspection is incomplete or unsupported. Review the flags and raw report.";
    } catch (error) {
      if (version !== requestVersion) return;
      state.dataset.state = "error";
      state.textContent = error.message;
      options.notify(error.message, true);
    } finally {
      if (version === requestVersion) submit.disabled = false;
    }
  });

  return {
    open() {
      form.reset();
      report.replaceChildren();
      report.hidden = true;
      state.dataset.state = "idle";
      state.textContent = "Enter a PDF or archive path inside the vault.";
      submit.disabled = false;
      dialog.showModal();
      form.elements.path.focus();
    },
  };
}
