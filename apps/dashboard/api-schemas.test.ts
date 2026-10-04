import { expect, it } from "vitest";
import { ApplySourceUpdateSchema, SourceUpdateQuerySchema } from "./api-schemas.ts";

it("rejects a source identifier that the core source contract cannot parse", () => {
  // Given
  const input = { sourceId: "source-1", referenceIndex: "0" };

  // When
  const result = SourceUpdateQuerySchema.safeParse(input);

  // Then
  expect(result.success).toBe(false);
});

it("rejects a merged body larger than the core source contract permits", () => {
  // Given
  const input = {
    sourceId: "prv_source",
    referenceIndex: 0,
    expectedHash: `sha256:${"a".repeat(64)}`,
    body: "x".repeat(2 * 1024 * 1024 + 1),
  };

  // When
  const result = ApplySourceUpdateSchema.safeParse(input);

  // Then
  expect(result.success).toBe(false);
});
