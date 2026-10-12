import { Hono } from "hono";
import { expect, it } from "vitest";
import { securityMiddleware } from "./security.ts";

it("allows dashboard style attributes without weakening stylesheet or script restrictions", async () => {
  // Given
  const app = new Hono();
  app.use(
    "*",
    securityMiddleware({
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    }),
  );
  app.get("/", (context) => context.text("dashboard"));

  // When
  const response = await app.request("/");
  const policy = response.headers.get("content-security-policy") ?? "";
  const directives = new Map(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/u);
      return [name ?? "", sources];
    }),
  );

  // Then
  expect(directives.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
  expect(directives.get("style-src-elem")).toEqual(["'self'", "data:"]);
  expect(directives.get("script-src")).toEqual(["'self'", "data:"]);
  expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
});
