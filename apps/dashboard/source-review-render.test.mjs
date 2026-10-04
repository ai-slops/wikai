import { describe, expect, it } from "vitest";
import { renderDetail } from "./public/render.js";

function container() {
  return { innerHTML: "" };
}

describe("blocked projection source review", () => {
  it("renders indexed fallback references when no working publication compiled", () => {
    // Given
    const target = container();
    const detail = {
      working: null,
      approved: null,
      sourceMode: "projection",
      sourceReferences: [
        { id: "source-shared", anchor: "heading:One" },
        { id: "source-shared", anchor: "heading:Two" },
      ],
      diagnostics: [{ severity: "error", code: "SOURCE_DRIFT", message: "Review source" }],
      history: [],
    };

    // When
    renderDetail(target, detail, { publicId: "pub_blocked", status: "blocked" });

    // Then
    expect(target.innerHTML).toContain('value="0" data-source-id="source-shared"');
    expect(target.innerHTML).toContain('value="1" data-source-id="source-shared"');
    expect(target.innerHTML).toContain("Review source update");
    expect(target.innerHTML).not.toContain("preview-frame");
    expect(target.innerHTML).toContain('id="metadata-button" type="button" disabled');
  });

  it("does not offer source re-extraction for a mirror publication", () => {
    // Given
    const target = container();

    // When
    renderDetail(
      target,
      {
        working: null,
        approved: null,
        sourceMode: "mirror",
        sourceReferences: [{ id: "source-one" }],
        diagnostics: [],
        history: [],
      },
      { publicId: "pub_mirror", status: "blocked" },
    );

    // Then
    expect(target.innerHTML).not.toContain("source-review-section");
  });
});
