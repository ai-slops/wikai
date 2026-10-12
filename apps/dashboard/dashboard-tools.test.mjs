import { afterEach, expect, it, vi } from "vitest";
import { api, initializeSession } from "./public/api.js";

afterEach(() => vi.unstubAllGlobals());

it("uses canonical tag filter and pinned batch approval contracts", async () => {
  // Given
  const requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      requests.push({ path, options });
      return new Response(JSON.stringify(path.endsWith("/session") ? { csrfToken: "proof" } : {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  await initializeSession();

  // When
  await api.filterByTags(["topic/react"], "subtree");
  await api.applyComponentUpdates(`sha256:${"a".repeat(64)}`);

  // Then
  expect(requests[1].path).toBe("/api/v1/tags/filter?tags=topic%2Freact&mode=subtree");
  expect(requests[2]).toMatchObject({
    path: "/api/v1/components/approve",
    options: {
      method: "POST",
      body: JSON.stringify({ expectedPlanHash: `sha256:${"a".repeat(64)}` }),
    },
  });
  expect(new Headers(requests[2].options.headers).get("x-csrf-token")).toBe("proof");
});
