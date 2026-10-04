import { ApiError, api } from "/api.js";

function selectorInput() {
  const values = [
    ["heading", document.querySelector("#source-review-heading")?.value.trim()],
    ["block", document.querySelector("#source-review-block")?.value.trim()],
    ["lines", document.querySelector("#source-review-lines")?.value.trim()],
  ].filter(([, value]) => value);
  if (values.length > 1) throw new Error("Choose only one replacement selector.");
  return values.length === 0 ? {} : { [values[0][0]]: values[0][1] };
}

function addProof(list, label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = String(value ?? "Unavailable");
  wrapper.append(term, description);
  list.append(wrapper);
}

function renderDiagnostics(container, diagnostics) {
  container.replaceChildren();
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return;
  const list = document.createElement("ul");
  list.className = "diagnostic-list";
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.className = `diagnostic diagnostic--${diagnostic.severity ?? "warning"}`;
    item.textContent = `${diagnostic.code ?? "SOURCE_UPDATE"}: ${diagnostic.message ?? String(diagnostic)}`;
    list.append(item);
  }
  container.append(list);
}

export function initializeSourceReview(options) {
  let requestVersion = 0;
  let reviewed = null;

  function currentElements() {
    return {
      source: document.querySelector("#source-review-source"),
      state: document.querySelector("#source-review-state"),
      result: document.querySelector("#source-review-result"),
      proof: document.querySelector("#source-review-proof"),
      projection: document.querySelector("#source-review-projection"),
      sourceBody: document.querySelector("#source-review-current"),
      changesWrap: document.querySelector("#source-review-changes-wrap"),
      changes: document.querySelector("#source-review-changes"),
      merge: document.querySelector("#source-review-merge"),
      diagnostics: document.querySelector("#source-review-diagnostics"),
      apply: document.querySelector("#source-review-apply"),
    };
  }

  function invalidateReview(message) {
    requestVersion += 1;
    reviewed = null;
    const elements = currentElements();
    if (!elements.state) return;
    elements.apply.disabled = true;
    elements.apply.textContent = "Apply reviewed merge";
    elements.result.hidden = true;
    elements.state.dataset.state = "idle";
    elements.state.textContent = message;
  }

  async function load() {
    const selection = options.selection();
    const elements = currentElements();
    if (!selection.id || !elements.source) return;
    const version = ++requestVersion;
    reviewed = null;
    elements.apply.disabled = true;
    elements.apply.textContent = "Apply reviewed merge";
    elements.result.hidden = true;
    elements.state.dataset.state = "loading";
    elements.state.textContent = "Reading the current projection and selected source…";
    try {
      const selectedSource = elements.source.selectedOptions[0];
      if (!selectedSource) throw new Error("Choose a tracked source before loading a comparison.");
      const input = {
        sourceId: selectedSource.dataset.sourceId,
        referenceIndex: Number(elements.source.value),
        ...selectorInput(),
      };
      const report = await api.sourceUpdate(selection.id, input);
      if (version !== requestVersion || !options.isCurrent(selection)) return;
      reviewed = { report, input, selection };
      elements.proof.replaceChildren();
      addProof(elements.proof, "Source path", report.sourcePath);
      addProof(elements.proof, "Reference index", report.referenceIndex);
      addProof(elements.proof, "Projection path", report.projectionPath);
      addProof(elements.proof, "Projection hash", report.projectionHash);
      addProof(elements.proof, "Source hash", report.sourceHash);
      addProof(elements.proof, "Expected write hash", report.expectedHash);
      elements.projection.textContent = report.projectionBody;
      elements.sourceBody.textContent = report.sourceBody ?? "Selected source text is unavailable.";
      const hasChanges = Array.isArray(report.changes) && report.changes.length > 0;
      elements.changes.textContent = hasChanges ? JSON.stringify(report.changes, null, 2) : "";
      elements.changesWrap.hidden = !hasChanges;
      elements.merge.value = report.projectionBody;
      renderDiagnostics(elements.diagnostics, report.diagnostics);
      elements.apply.disabled = !report.canApply;
      elements.result.hidden = false;
      elements.state.dataset.state = report.canApply ? "complete" : "warning";
      elements.state.textContent = report.canApply
        ? "Comparison ready. Edit the merge before applying it explicitly."
        : "This source cannot be applied yet. Review diagnostics and provide an explicit selector if requested.";
    } catch (error) {
      if (version !== requestVersion || !options.isCurrent(selection)) return;
      elements.state.dataset.state = "error";
      elements.state.textContent = error.message;
      options.notify(error.message, true);
    }
  }

  async function apply() {
    const elements = currentElements();
    if (!reviewed || !options.isCurrent(reviewed.selection)) return;
    const version = ++requestVersion;
    elements.apply.disabled = true;
    elements.apply.textContent = "Apply reviewed merge";
    elements.state.dataset.state = "loading";
    elements.state.textContent = "Applying the explicitly reviewed merge…";
    try {
      const pendingReview = reviewed;
      await api.applySourceUpdate(reviewed.selection.id, {
        ...reviewed.input,
        expectedHash: reviewed.report.expectedHash,
        body: elements.merge.value,
      });
      if (version !== requestVersion || !options.isCurrent(pendingReview.selection)) return;
      elements.state.dataset.state = "complete";
      elements.state.textContent =
        "Merge applied to the private projection. Approval remains separate.";
      options.notify("Reviewed source merge applied.");
      await options.onApplied();
    } catch (error) {
      if (version !== requestVersion || !options.isCurrent(reviewed.selection)) return;
      const stale = error instanceof ApiError && error.code === "STALE_SOURCE_UPDATE";
      elements.state.dataset.state = stale ? "stale" : "error";
      elements.state.textContent = stale
        ? error.message
        : `${error.message} Correct the issue or retry this reviewed merge.`;
      options.notify(error.message, true);
      if (stale) reviewed = null;
      elements.apply.disabled = stale;
      if (!stale) elements.apply.textContent = "Retry reviewed merge";
    }
  }

  document.querySelector("#detail").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.id === "source-review-load") load();
    if (button?.id === "source-review-apply") apply();
  });
  document.querySelector("#detail").addEventListener("change", (event) => {
    if (event.target.id !== "source-review-source") return;
    for (const selector of ["heading", "block", "lines"]) {
      document.querySelector(`#source-review-${selector}`).value = "";
    }
    invalidateReview("Source changed. Load a new read-only comparison.");
  });
  document.querySelector("#detail").addEventListener("input", (event) => {
    if (!event.target.id?.startsWith("source-review-")) return;
    if (event.target.id === "source-review-merge") return;
    invalidateReview("Selector changed. Load a new read-only comparison.");
  });
}
