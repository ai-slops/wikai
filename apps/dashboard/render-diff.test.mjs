import { describe, expect, it } from "vitest";
import { renderDetail } from "./public/render.js";

function container() {
  return { innerHTML: "" };
}

function detail(overrides = {}) {
  return {
    working: {
      metadata: { title: "Working title", slug: "/working", kind: "knowledge" },
      markdown: "Shared line\nWorking line\n",
      outgoingLinks: [{ title: "Working link", slug: "/working-link" }],
      assets: [{ publicPath: "working.png", hash: "sha256:working" }],
      diagnostics: [],
      exposureHash: "sha256:working",
    },
    approved: {
      metadata: { title: "Approved title", slug: "/approved", kind: "knowledge" },
      markdown: "Shared line\nApproved line\n",
      outgoingLinks: [{ title: "Approved link", slug: "/approved-link" }],
      assets: [{ publicPath: "approved.png", hash: "sha256:approved" }],
      diagnostics: [],
      exposureHash: "sha256:approved",
    },
    diagnostics: [],
    history: [],
    ...overrides,
  };
}

describe("four-part publication diff", () => {
  it("renders additions and deletions with explicit original and proposed labels", () => {
    // Given
    const target = container();

    // When
    renderDetail(target, detail(), { publicId: "pub_diff", status: "update-available" });

    // Then
    expect(target.innerHTML).toContain('class="diff-part diff-part--removed"');
    expect(target.innerHTML).toContain('class="diff-part diff-part--added"');
    expect(target.innerHTML).toContain("− Original approved");
    expect(target.innerHTML).toContain("+ Proposed working");
    expect(target.innerHTML).toContain("− Approved line");
    expect(target.innerHTML).toContain("+ Working line");
    expect(target.innerHTML).not.toContain("WORKING\n");
  });

  it("shows a meaningful unchanged state and detects a missing final newline", () => {
    // Given
    const target = container();
    const unchanged = detail();
    unchanged.working.markdown = "Same\n";
    unchanged.approved.markdown = "Same\n";

    // When
    renderDetail(target, unchanged, { publicId: "pub_same", status: "published" });

    // Then
    expect(target.innerHTML).toContain("No changes in public Markdown.");

    // Given
    const newlineTarget = container();
    unchanged.working.markdown = "Same";

    // When
    renderDetail(newlineTarget, unchanged, { publicId: "pub_newline", status: "review" });

    // Then
    expect(newlineTarget.innerHTML).not.toContain("No changes in public Markdown.");
    expect(newlineTarget.innerHTML).toContain("No newline at end of file");
  });

  it("ignores top-level managed verification timestamps", () => {
    // Given
    const target = container();
    const managedDateOnly = detail();
    const metadata = { title: "Same title", slug: "/same", kind: "knowledge" };
    managedDateOnly.approved.metadata = {
      ...metadata,
      lastVerifiedAt: "2026-09-01T00:00:00.000Z",
    };
    managedDateOnly.working.metadata = {
      ...metadata,
      lastVerifiedAt: "2026-10-01T00:00:00.000Z",
    };

    // When
    renderDetail(target, managedDateOnly, { publicId: "pub_managed_date", status: "published" });

    // Then
    expect(target.innerHTML).toContain("No changes in metadata.");
    expect(target.innerHTML).not.toContain("2026-09-01T00:00:00.000Z");
    expect(target.innerHTML).not.toContain("2026-10-01T00:00:00.000Z");
  });

  it("keeps nested knowledge verification timestamps meaningful", () => {
    // Given
    const target = container();
    const nestedDateChange = detail();
    const metadata = { title: "Same title", slug: "/same", kind: "knowledge" };
    nestedDateChange.approved.metadata = {
      ...metadata,
      knowledge: { lastVerifiedAt: "2026-09-01T00:00:00.000Z" },
    };
    nestedDateChange.working.metadata = {
      ...metadata,
      knowledge: { lastVerifiedAt: "2026-10-01T00:00:00.000Z" },
    };

    // When
    renderDetail(target, nestedDateChange, { publicId: "pub_nested_date", status: "review" });

    // Then
    expect(target.innerHTML).not.toContain("No changes in metadata.");
    expect(target.innerHTML).toMatch(/diff-part--removed[^>]+2026-09-01T00:00:00\.000Z/);
    expect(target.innerHTML).toMatch(/diff-part--added[^>]+2026-10-01T00:00:00\.000Z/);
  });

  it("preserves whitespace-only line changes", () => {
    // Given
    const target = container();
    const whitespaceChange = detail();
    whitespaceChange.approved.markdown = "Indented\n";
    whitespaceChange.working.markdown = "  Indented\n";

    // When
    renderDetail(target, whitespaceChange, { publicId: "pub_whitespace", status: "review" });

    // Then
    expect(target.innerHTML).toContain("− Indented");
    expect(target.innerHTML).toContain("+   Indented");
  });

  it("treats a first approval as additions and escapes public text", () => {
    // Given
    const target = container();
    const firstApproval = detail({ approved: null });
    firstApproval.working.markdown = '<script>alert("private")</script>\n';

    // When
    renderDetail(target, firstApproval, { publicId: "pub_first", status: "review" });

    // Then
    expect(target.innerHTML).toContain("No approved revision. All proposed lines are additions.");
    expect(target.innerHTML).toContain("&lt;script&gt;alert(&quot;private&quot;)&lt;/script&gt;");
    expect(target.innerHTML).not.toContain('<script>alert("private")</script>');
    expect(target.innerHTML).not.toContain('class="diff-part diff-part--removed"');
  });

  it("preserves the approved state when no working revision is available", () => {
    // Given
    const target = container();
    const blocked = detail({ working: null });

    // When
    renderDetail(target, blocked, { publicId: "pub_blocked", status: "blocked" });

    // Then
    expect(target.innerHTML).toContain("Working revision unavailable");
    expect(target.innerHTML).toContain("The approved revision remains unchanged");
    expect(target.innerHTML).not.toContain('class="diff-part diff-part--removed"');
    expect(target.innerHTML).toContain("sha256:approved");
  });

  it("renders an available empty working body as a legitimate deletion", () => {
    // Given
    const target = container();
    const deletion = detail();
    deletion.working.markdown = "";
    deletion.approved.markdown = "Approved body\n";

    // When
    renderDetail(target, deletion, { publicId: "pub_empty", status: "update-available" });

    // Then
    expect(target.innerHTML).toContain("− Approved body");
    expect(target.innerHTML).not.toContain("Working revision unavailable");
  });

  it("retains final-newline markers when the bounded fallback is used", () => {
    // Given
    const target = container();
    const fallback = detail();
    const largeBody = Array.from({ length: 501 }, (_, index) => `Line ${index}`).join("\n");
    fallback.approved.markdown = `${largeBody}\n`;
    fallback.working.markdown = largeBody;

    // When
    renderDetail(target, fallback, { publicId: "pub_large", status: "update-available" });

    // Then
    expect(target.innerHTML).toContain("No newline at end of file");
    expect(target.innerHTML).toContain("Final newline");
  });

  it("ignores private asset provenance when public exposure fields are unchanged", () => {
    // Given
    const target = container();
    const provenanceOnly = detail();
    provenanceOnly.approved.assets = [
      {
        publicPath: "/assets/report.pdf",
        hash: "sha256:report",
        mime: "application/pdf",
        bytes: 42,
        sourcePath: "private/old-report.pdf",
        reviewed: false,
      },
    ];
    provenanceOnly.working.assets = [
      {
        publicPath: "/assets/report.pdf",
        hash: "sha256:report",
        mime: "application/pdf",
        bytes: 42,
        sourcePath: "private/new-report.pdf",
        reviewed: true,
      },
    ];

    // When
    renderDetail(target, provenanceOnly, { publicId: "pub_assets", status: "review" });

    // Then
    expect(target.innerHTML).toContain("No changes in assets.");
    expect(target.innerHTML).not.toContain("private/old-report.pdf");
    expect(target.innerHTML).not.toContain("private/new-report.pdf");
  });
});

describe("diagnostic rendering", () => {
  it("merges global and working diagnostics, deduplicates them, and renders source locations", () => {
    // Given
    const target = container();
    const ranged = {
      severity: "error",
      code: "PRIVATE_TARGET_LINK",
      message: "Private target",
      sourcePath: "notes/example.md",
      sourceRange: { startLine: 12, startColumn: 7, endLine: 12, endColumn: 14 },
    };
    const value = detail({
      diagnostics: [ranged, { severity: "warning", code: "GLOBAL", message: "Global warning" }],
    });
    value.working.diagnostics = [ranged];

    // When
    renderDetail(target, value, { publicId: "pub_blocked", status: "blocked" });

    // Then
    expect(target.innerHTML).toContain("notes/example.md:12:7");
    expect(target.innerHTML).toContain("GLOBAL");
    expect(target.innerHTML.match(/PRIVATE_TARGET_LINK/g)).toHaveLength(1);
  });
});
