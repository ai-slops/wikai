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
  return `<ul class="diagnostic-list">${diagnostics.map((item) => `<li class="diagnostic diagnostic--${escapeHtml(item.severity)}"><code>${escapeHtml(item.code)}</code><br>${escapeHtml(item.message)}${item.hint ? `<br><small>${escapeHtml(item.hint)}</small>` : ""}</li>`).join("")}</ul>`;
}

function arraySummary(items, formatter) {
  if (!items?.length) return "None";
  return items.map(formatter).join("\n");
}

function reviewMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(
      ([key]) => !["publishedAt", "updatedAt", "lastReviewedAt"].includes(key),
    ),
  );
}

function buildDiff(working, approved) {
  const sections = [
    [
      "01 / Metadata",
      JSON.stringify(reviewMetadata(working?.metadata), null, 2),
      approved
        ? JSON.stringify(reviewMetadata(approved.metadata), null, 2)
        : "No approved revision",
    ],
    [
      "02 / Public Markdown",
      working?.markdown || "Empty",
      approved?.markdown || "No approved revision",
    ],
    [
      "03 / Outgoing links",
      arraySummary(working?.outgoingLinks, (link) => `${link.title} → ${link.slug}`),
      arraySummary(approved?.outgoingLinks, (link) => `${link.title} → ${link.slug}`),
    ],
    [
      "04 / Assets",
      arraySummary(working?.assets, (asset) => `${asset.publicPath}  ${asset.hash}`),
      arraySummary(approved?.assets, (asset) => `${asset.publicPath}  ${asset.hash}`),
    ],
  ];
  return sections
    .map(
      ([label, current, previous]) =>
        `── ${label} ──\nWORKING\n${current}\n\nAPPROVED\n${previous}`,
    )
    .join("\n\n");
}

export function renderDetail(container, detail, row) {
  const working = detail.working;
  const approved = detail.approved;
  const title = working?.metadata?.title || row?.title || row?.publicId || "Publication";
  const summary =
    working?.metadata?.summary ||
    "Inspect the exact public content, links, and assets before approval.";
  const exposureHash = working?.exposureHash || row?.exposureHash || "";
  const approvedHash = approved?.exposureHash || row?.approvedHash || "";
  const diagnostics = working?.diagnostics || detail.diagnostics || row?.diagnostics || [];
  container.innerHTML = `<header class="detail-header">
    <button class="button button--quiet mobile-back" id="back-button" type="button">Back to queue</button>
    <div class="title-actions"><div><span class="kicker">${escapeHtml(row?.kind || working?.metadata?.kind || "publication")} / ${escapeHtml(row?.status || working?.workflowStatus || "review")}</span><h1>${escapeHtml(title)}</h1></div>
    <div class="action-cluster"><button class="button button--quiet" id="withdraw-button" type="button" ${approvedHash ? "" : "disabled"}>Withdraw</button><button class="button button--ink" id="approve-button" type="button" ${exposureHash ? "" : "disabled"}>Approve exact hash</button></div></div>
    <p class="lede">${escapeHtml(summary)}</p>
  </header>
  ${detail.sourceDrift ? '<div class="diagnostic diagnostic--error"><strong>Source drift detected.</strong> Recompile before approving this revision.</div>' : ""}
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Publication record</span><h2>Public metadata</h2></div><button class="button button--quiet" id="metadata-button" type="button">Edit source metadata</button></div><dl class="metadata-grid">${metadataList(working)}</dl>${working?.sourcePath ? `<p class="local-source"><strong>Local source · private dashboard only</strong><code>${escapeHtml(working.sourcePath)}</code></p>` : ""}</section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Review inventory</span><h2>Exposure summary</h2></div></div><dl class="metadata-grid exposure-grid">${exposureList(working, diagnostics)}</dl></section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Bound revision</span><h2>Exposure proof</h2></div></div><dl class="hash-grid"><div><dt>Working exposure hash</dt><dd class="hash">${escapeHtml(exposureHash || "Unavailable")}</dd></div><div><dt>Approved exposure hash</dt><dd class="hash">${escapeHtml(approvedHash || "Not yet approved")}</dd></div></dl></section>
  <section class="review-section"><div class="section-heading"><div><span class="kicker">Public surface</span><h2>Preview & four-part diff</h2></div></div>
    <div class="tab-strip" role="tablist" aria-label="Review mode"><button role="tab" id="preview-tab" aria-selected="true" aria-controls="preview-panel" tabindex="0">Working preview</button><button role="tab" id="approved-tab" aria-selected="false" aria-controls="preview-panel" tabindex="-1">Approved preview</button><button role="tab" id="diff-tab" aria-selected="false" aria-controls="diff-panel" tabindex="-1">Four-part diff</button></div>
    <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab"><iframe class="preview-frame" id="preview-frame" title="Sandboxed public working preview" sandbox></iframe></div>
    <pre class="diff-view" id="diff-panel" role="tabpanel" aria-labelledby="diff-tab" hidden>${escapeHtml(buildDiff(working, approved))}</pre>
  </section>
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
