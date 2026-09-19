import { describe, expect, it } from "vitest";
import { InternalPathSchema } from "./schema.ts";

describe("internal public paths", () => {
  it("accepts the canonical root path", () => {
    // Given the fixed home route, when state validates it, then the canonical root remains valid.
    expect(InternalPathSchema.parse("/")).toBe("/");
  });

  it.each(["//", "/home/", "/home//child", "/home/../private"])(
    "rejects noncanonical path %s",
    (path) => {
      // Given a malformed internal route, when state validates it, then it fails closed.
      expect(() => InternalPathSchema.parse(path)).toThrow();
    },
  );
});
