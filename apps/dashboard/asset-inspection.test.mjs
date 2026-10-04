import { expect, it } from "vitest";
import { inspectionMessage } from "./public/inspection-format.js";

it("formats generic inspection warnings without losing their code or message", () => {
  // Given
  const warning = {
    code: "PDF_XMP_REVIEW_REQUIRED",
    message: "Review the inert XMP packet text manually.",
  };

  // When
  const message = inspectionMessage(warning);

  // Then
  expect(message).toBe("PDF_XMP_REVIEW_REQUIRED: Review the inert XMP packet text manually.");
});

it("keeps unknown warning values inspectable instead of rendering object coercion", () => {
  // Given
  const warning = { category: "metadata", fields: ["xmp", "author"] };

  // When
  const message = inspectionMessage(warning);

  // Then
  expect(message).toBe('{"category":"metadata","fields":["xmp","author"]}');
});
