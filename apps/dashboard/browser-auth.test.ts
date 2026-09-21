import { expect, it } from "vitest";
import { publisher } from "./server.test-fixture.ts";
import { createDashboardApp } from "./server.ts";

const token = "test-only-browser-password-with-32-characters";
const app = () =>
  createDashboardApp({
    publisher: publisher(),
    csrfToken: "csrf",
    allowedOrigin: "https://studio.example",
    bearerToken: token,
  });

it("challenges an unauthenticated browser before returning the studio", async () => {
  const response = await app().request("/");
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Basic");
});

it("accepts browser Basic authentication without removing bearer support", async () => {
  const response = await app().request("/api/v1/publications", {
    headers: { authorization: `Basic ${Buffer.from(`wikai:${token}`).toString("base64")}` },
  });
  expect(response.status).toBe(200);
  const bearer = await app().request("/api/v1/publications", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(bearer.status).toBe(200);
});

it("rejects wrong browser credentials", async () => {
  const response = await app().request("/api/v1/publications", {
    headers: { authorization: `Basic ${Buffer.from(`other:${token}`).toString("base64")}` },
  });
  expect(response.status).toBe(401);
});

it("still requires CSRF proof for authenticated browser mutations", async () => {
  const response = await app().request("/api/v1/build", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`wikai:${token}`).toString("base64")}`,
      origin: "https://studio.example",
    },
  });
  expect(response.status).toBe(403);
});
