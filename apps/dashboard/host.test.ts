import { expect, it } from "vitest";
import { publisher } from "./server.test-fixture.ts";
import { createDashboardApp } from "./server.ts";

it("rejects a rebinding hostname before exposing private read APIs", async () => {
  const app = createDashboardApp({
    publisher: publisher(),
    csrfToken: "csrf",
    allowedOrigin: "http://127.0.0.1:3000",
  });
  const response = await app.request("/api/v1/plan", {
    headers: { host: "attacker.invalid:3000" },
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
