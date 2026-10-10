import { renderPublicationDiff } from "./diff-render.js";

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character],
  );
}

function titleOf(row) {
  return row.title || row.slug || row.publicId || "Untitled publication";
}

export function renderQueue(container, publications, selectedId) {
  if (publications.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><span class="kicker">Queue clear</span><h2>No publications match these filters.</h2><p>Adjust the state, kind, or search query.</p></div>';
    return;
  }
  container.innerHTML = publications
    .map((row) => {
      const state = escapeHtml(row.status || "private");
      const errors = Array.isArray(row.diagnostics)
        ? row.diagnostics.filter((item) => item.severity === "error").length
        : 0;
      return `<button class="queue-row" type="button" data-public-id="${escapeHtml(row.publicId)}" aria-current="${row.publicId === selectedId}">
      <span class="row-meta"><i class="status-dot status-dot--${state}"></i>${state}</span>
      <strong>${escapeHtml(titleOf(row))}</strong>
      <span class="row-footer"><span>${escapeHtml(row.kind || "—")}</span><span>${errors ? `${errors} errors` : escapeHtml(row.slug || row.publicId)}</span></span>
    </button>`;
    })
    .join("");
}

function metadataList(working) {
  const metadata = working?.metadata ?? {};
  const values = [
    ["Public ID", working?.publicId],
    ["Slug", metadata.slug],
    ["Kind", metadata.kind],
    ["Content state", metadata.contentState || "—"],
    ["Listed", metadata.listed ? "Yes" : "No"],
    ["Indexed", metadata.index ? "Yes" : "No"],
  ];
  return values
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "—")}</dd></div>`,
    )
    .join("");
}

function exposureList(working, diagnostics) {
  const markdown = working?.markdown || "";
  const warnings = (diagnostics || []).filter((item) => item.severity !== "info");
  const values = [
    ["Pages", working ? 1 : 0],
    ["Assets", working?.assets?.length || 0],
    ["External links", (markdown.match(/\]\(https?:\/\//gu) || []).length],
    ["Internal links", working?.outgoingLinks?.length || 0],
    [
      "Private-link findings",
      warnings.filter((item) => item.code === "PRIVATE_TARGET_LINK").length,
    ],
    ["Warnings", warnings.length],
  ];
  return values
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd class="exposure-count">${escapeHtml(value)}</dd></div>`,
    )
    .join("");
}

function diagnosticList(diagnostics) {
  if (!diagnostics?.length) return '<p class="muted">No diagnostics for this working revision.</p>';
  return `<ul class="diagnostic-list">${diagnostics
    .map((item) => {
      const location = item.sourcePath
        ? `${item.sourcePath}${item.sourceRange ? `:${item.sourceRange.startLine}:${item.sourceRange.startColumn}` : ""}`
        : "";
      return `<li class="diagnostic diagnostic--${escapeHtml(item.severity)}"><div class="diagnostic-heading"><code>${escapeHtml(item.code)}</code>${location ? `<span class="diagnostic-location">${escapeHtml(location)}</span>` : ""}</div>${escapeHtml(item.message)}${item.hint ? `<br><small>${escapeHtml(item.hint)}</small>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

export function publicationDiagnostics(detail, row) {
  const diagnostics = [
    ...(detail.working?.diagnostics ?? []),
    ...(detail.diagnostics ?? []),
    ...(row?.diagnostics ?? []),
  ];
  const seen = new Set();
  return diagnostics.filter((item) => {
    const range = item.sourceRange;
    const key = [
      item.severity,
      item.code,
      item.message,
      item.hint,
      item.sourcePath,
      range?.startLine,
      range?.startColumn,
      range?.endLine,
      range?.endColumn,
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceReviewSection(sources, sourceMode) {
  if (sourceMode === "mirror") return "";
  if (!sources?.length) {
    return `<section class="review-section"><div class="section-heading"><div><span class="kicker">Projection sources</span><h2>Source re-extraction</h2></div></div><p class="muted">This publication has no tracked projection sources.</p></section>`;
  }
  const options = sources
    .map((source, referenceIndex) => {
      const selector = source.selection?.kind || source.anchor || "whole source";
      return `<option value="${referenceIndex}" data-source-id="${escapeHtml(source.id)}">${escapeHtml(source.id)} · ${escapeHtml(selector)}</option>`;
    })
    .join("");
  return `<section class="review-section" id="source-review-section"><div class="section-heading"><div><span class="kicker">Projection sources</span><h2>Review source update</h2></div></div>
    <p class="muted">Compare the current projection with freshly selected source text. Loading never writes; applying uses only the merged Markdown you submit.</p>
    <div class="source-review-controls"><label>Tracked source<select id="source-review-source">${options}</select></label><button class="button button--quiet" id="source-review-load" type="button">Load comparison</button></div>
    <details><summary>Use a replacement selector</summary><p class="muted">Choose exactly one only when a changed line snapshot cannot be resolved safely.</p><div class="source-selector-fields"><label>Heading<input id="source-review-heading" autocomplete="off"></label><label>Block ID<input id="source-review-block" autocomplete="off"></label><label>Line range<input id="source-review-lines" inputmode="numeric" placeholder="14:32" pattern="\\d+:\\d+"></label></div></details>
    <div class="tool-state" id="source-review-state" role="status" aria-live="polite">Select a source and load a read-only comparison.</div>
    <div id="source-review-result" hidden><dl class="source-proof-grid" id="source-review-proof"></dl><div class="source-compare"><div><h3>Current projection</h3><pre class="source-pane" id="source-review-projection"></pre></div><div><h3>Selected source</h3><pre class="source-pane" id="source-review-current"></pre></div></div><div id="source-review-changes-wrap" hidden><h3>Selection changes</h3><pre class="source-pane" id="source-review-changes"></pre></div><label class="merge-field">Manual merged Markdown<textarea class="merge-editor" id="source-review-merge" rows="14" spellcheck="false"></textarea></label><div id="source-review-diagnostics"></div><div class="source-apply-row"><span class="muted">Applying updates the private projection only. Approval remains separate.</span><button class="button button--ink" id="source-review-apply" type="button" disabled>Apply reviewed merge</button></div></div>
  </section>`;
}

export function renderDetail(container, detail, row) {
  const working = detail.working;
  const approved = detail.approved;
  const sourceReferences = working?.sources ?? detail.sourceReferences ?? [];
  const sourceMode = working?.sourceMode ?? detail.sourceMode;
  const title = working?.metadata?.title || row?.title || row?.publicId || "Publication";
  const summary =
    working?.metadata?.summary ||
    "Inspect the exact public content, links, and assets before approval.";
  const exposureHash = working?.exposureHash || row?.exposureHash || "";
  const approvedHash = approved?.exposureHash || row?.approvedHash || "";
  const diagnostics = publicationDiagnostics(detail, row);
  container.innerHTML = `<header class="detail-header">
    <button class="button button--quiet mobile-back" id="back-button" type="button">Back to queue</button>
    <div class="title-actions"><div><span class="kicker">${escapeHtml(row?.kind || working?.metadata?.kind || "publication")} / ${escapeHtml(row?.status || working?.workflowStatus || "review")}</span><h1>${escapeHtml(title)}</h1></div>
    <div class="action-cluster"><button class="button button--quiet" id="withdraw-button" type="button" ${approvedHash ? "" : "disabled"}>Withdraw</button><button class="button button--ink" id="approve-button" type="button" ${exposureHash ? "" : "disabled"}>Approve exact hash</button></div></div>
    <p class="lede">${escapeHtml(summary)}</p>
  </header>
  ${detail.sourceDrift ? '<div class="diagnostic diagnostic--error"><strong>Source drift detected.</strong> Recompile before approving this revision.</div>' : ""}
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Publication record</span><h2>Public metadata</h2></div><button class="button button--quiet" id="metadata-button" type="button" ${working ? "" : "disabled"}>Edit source metadata</button></div><dl class="metadata-grid">${metadataList(working)}</dl>${working?.sourcePath ? `<p class="local-source"><strong>Local source · private dashboard only</strong><code>${escapeHtml(working.sourcePath)}</code></p>` : ""}</section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Review inventory</span><h2>Exposure summary</h2></div></div><dl class="metadata-grid exposure-grid">${exposureList(working, diagnostics)}</dl></section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Bound revision</span><h2>Exposure proof</h2></div></div><dl class="hash-grid"><div><dt>Working exposure hash</dt><dd class="hash">${escapeHtml(exposureHash || "Unavailable")}</dd></div><div><dt>Approved exposure hash</dt><dd class="hash">${escapeHtml(approvedHash || "Not yet approved")}</dd></div></dl></section>
  ${
    working || approved
      ? `<section class="review-section"><div class="section-heading"><div><span class="kicker">Public surface</span><h2>Preview & four-part diff</h2></div></div>
    <div class="tab-strip" role="tablist" aria-label="Review mode"><button role="tab" id="preview-tab" aria-selected="true" aria-controls="preview-panel" tabindex="0">Working preview</button><button role="tab" id="approved-tab" aria-selected="false" aria-controls="preview-panel" tabindex="-1">Approved preview</button><button role="tab" id="diff-tab" aria-selected="false" aria-controls="diff-panel" tabindex="-1">Four-part diff</button></div>
    <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab"><iframe class="preview-frame" id="preview-frame" title="Sandboxed public working preview" sandbox></iframe></div>
    <div id="diff-panel" role="tabpanel" aria-labelledby="diff-tab" hidden>${renderPublicationDiff(working, approved)}</div>
  </section>`
      : ""
  }
  ${sourceReviewSection(sourceReferences, sourceMode)}
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Compiler report</span><h2>Diagnostics</h2></div></div>${diagnosticList(diagnostics)}</section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Revision ledger</span><h2>History</h2></div></div>${detail.history?.length ? `<ol>${detail.history.map((item) => `<li><button class="button button--quiet restore-button" data-revision-hash="${escapeHtml(item.revisionHash)}">Restore ${escapeHtml(item.revisionHash.slice(0, 12))}</button> <span class="muted">${escapeHtml(item.approvedAt || "")}</span></li>`).join("")}</ol>` : '<p class="muted">No earlier approved revisions.</p>'}</section>`;
}

export function renderUnavailableDetail(container, row) {
  container.innerHTML = `<header class="detail-header">
    <button class="button button--quiet mobile-back" id="back-button" type="button">Back to queue</button>
    <span class="kicker">${escapeHtml(row?.kind || "publication")} / ${escapeHtml(row?.status || "blocked")}</span>
    <h1>${escapeHtml(titleOf(row))}</h1>
    <p class="lede">No safe working or approved revision can be rendered yet. Resolve the compiler findings below, then refresh the queue.</p>
  </header>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Compiler report</span><h2>Why this publication is blocked</h2></div></div>${diagnosticList(row?.diagnostics)}</section>`;
}

export function renderSummary(container, publications) {
  const count = (states) => publications.filter((row) => states.includes(row.status)).length;
  container.innerHTML = `<div><dt>In review</dt><dd>${count(["candidate", "review", "update-available"])}</dd></div><div><dt>Blocked</dt><dd>${count(["blocked", "source-drift"])}</dd></div><div><dt>Published</dt><dd>${count(["published"])}</dd></div>`;
}

export function renderDiagnosticRail(container, diagnostics) {
  container.innerHTML = `<span class="kicker">Diagnostics</span>${diagnosticList(diagnostics)}`;
}
