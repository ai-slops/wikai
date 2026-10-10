const MAX_DIFF_CELLS = 250_000;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character],
  );
}

function visibleMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(
      ([key]) => !["publishedAt", "updatedAt", "lastReviewedAt", "lastVerifiedAt"].includes(key),
    ),
  );
}

function serialized(value) {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function lines(value) {
  if (value === "") return [];
  const result = value.split("\n");
  if (value.endsWith("\n")) result.pop();
  return result;
}

function finalNewlineChanges(original, proposed) {
  if (original.endsWith("\n") === proposed.endsWith("\n")) return [];
  return [
    ...(original === ""
      ? []
      : [
          {
            kind: "removed",
            value: original.endsWith("\n") ? "Final newline" : "No newline at end of file",
          },
        ]),
    ...(proposed === ""
      ? []
      : [
          {
            kind: "added",
            value: proposed.endsWith("\n") ? "Final newline" : "No newline at end of file",
          },
        ]),
  ];
}

function lineChanges(original, proposed) {
  const originalLines = lines(original);
  const proposedLines = lines(proposed);
  if (original === proposed) return [];
  if (originalLines.length * proposedLines.length > MAX_DIFF_CELLS) {
    return [
      ...originalLines.map((value) => ({ kind: "removed", value })),
      ...proposedLines.map((value) => ({ kind: "added", value })),
      ...finalNewlineChanges(original, proposed),
    ];
  }

  const width = proposedLines.length + 1;
  const matrix = new Uint32Array((originalLines.length + 1) * width);
  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let proposedIndex = proposedLines.length - 1; proposedIndex >= 0; proposedIndex -= 1) {
      const index = originalIndex * width + proposedIndex;
      matrix[index] =
        originalLines[originalIndex] === proposedLines[proposedIndex]
          ? matrix[(originalIndex + 1) * width + proposedIndex + 1] + 1
          : Math.max(
              matrix[(originalIndex + 1) * width + proposedIndex],
              matrix[originalIndex * width + proposedIndex + 1],
            );
    }
  }

  const changes = [];
  let originalIndex = 0;
  let proposedIndex = 0;
  while (originalIndex < originalLines.length || proposedIndex < proposedLines.length) {
    if (originalLines[originalIndex] === proposedLines[proposedIndex]) {
      changes.push({ kind: "unchanged", value: originalLines[originalIndex] });
      originalIndex += 1;
      proposedIndex += 1;
    } else if (
      proposedIndex < proposedLines.length &&
      (originalIndex === originalLines.length ||
        matrix[originalIndex * width + proposedIndex + 1] >=
          matrix[(originalIndex + 1) * width + proposedIndex])
    ) {
      changes.push({ kind: "added", value: proposedLines[proposedIndex] });
      proposedIndex += 1;
    } else {
      changes.push({ kind: "removed", value: originalLines[originalIndex] });
      originalIndex += 1;
    }
  }
  return [...changes, ...finalNewlineChanges(original, proposed)];
}

function renderLine(change) {
  const symbol = change.kind === "added" ? "+" : change.kind === "removed" ? "−" : " ";
  const action =
    change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Unchanged";
  return `<span class="diff-part diff-part--${change.kind}" aria-label="${action}: ${escapeHtml(change.value)}">${symbol} ${escapeHtml(change.value)}</span>`;
}

function renderSection(section, firstApproval) {
  const changes = lineChanges(section.original, section.proposed);
  const state =
    changes.length === 0
      ? `<p class="diff-empty">No changes in ${escapeHtml(section.description)}.</p>`
      : `<pre class="diff-lines" aria-label="${escapeHtml(section.title)} changes">${changes.map(renderLine).join("\n")}</pre>`;
  return `<section class="diff-section" aria-labelledby="diff-${section.id}"><header class="diff-heading"><span class="kicker">${escapeHtml(section.number)} / Public surface</span><h3 class="diff-title" id="diff-${section.id}">${escapeHtml(section.title)}</h3></header>${
    firstApproval
      ? '<p class="diff-first">No approved revision. All proposed lines are additions.</p>'
      : ""
  }${state}</section>`;
}

export function renderPublicationDiff(working, approved) {
  if (!working && approved)
    return '<div class="diff-view"><div class="diff-unavailable" role="status"><strong>Working revision unavailable.</strong><p>The approved revision remains unchanged. Resolve the blocking diagnostics before comparing a proposed revision.</p></div></div>';

  const publicAssets = (assets) =>
    (assets ?? []).map(({ publicPath, hash, mime, bytes }) => ({ publicPath, hash, mime, bytes }));
  const sections = [
    {
      id: "metadata",
      number: "01",
      title: "Metadata",
      description: "metadata",
      original: approved ? serialized(visibleMetadata(approved.metadata)) : "",
      proposed: working ? serialized(visibleMetadata(working.metadata)) : "",
    },
    {
      id: "markdown",
      number: "02",
      title: "Public Markdown",
      description: "public Markdown",
      original: approved?.markdown ?? "",
      proposed: working?.markdown ?? "",
    },
    {
      id: "links",
      number: "03",
      title: "Outgoing links",
      description: "outgoing links",
      original: approved ? serialized(approved.outgoingLinks ?? []) : "",
      proposed: working ? serialized(working.outgoingLinks ?? []) : "",
    },
    {
      id: "assets",
      number: "04",
      title: "Assets",
      description: "assets",
      original: approved ? serialized(publicAssets(approved.assets)) : "",
      proposed: working ? serialized(publicAssets(working.assets)) : "",
    },
  ];
  return `<div class="diff-view"><div class="diff-legend" aria-label="Diff legend"><span>− Original approved</span><span>+ Proposed working</span></div>${sections.map((section) => renderSection(section, !approved)).join("")}</div>`;
}
