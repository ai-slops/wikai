import { expect, it } from "vitest";
import { publisher } from "./server.test-fixture.ts";
import { createDashboardApp } from "./server.ts";

it("returns a JSON receipt after a void-returning withdrawal succeeds", async () => {
  const service = { ...publisher(), withdraw: async () => undefined };
  const app = createDashboardApp({
    publisher: service,
    csrfToken: "csrf",
    allowedOrigin: "http://localhost:3000",
  });
  const response = await app.request("/api/v1/publications/pub_alpha/withdraw", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "x-csrf-token": "csrf",
      "content-type": "application/json",
    },
    body: JSON.stringify({ expectedHash: "hash-approved" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ publicId: "pub_alpha", withdrawn: true });
});
