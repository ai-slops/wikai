import { describe, expect, it, vi } from "vitest";
import { PublisherError } from "../../packages/model/index.ts";
import { publisher } from "./server.test-fixture.ts";
import { createDashboardApp, parseServerConfig } from "./server.ts";

describe("dashboard API", () => {
  it("returns publication status with safe headers", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/status");

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ publications: [{ publicId: "pub_alpha" }] });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("returns the publication queue from the canonical publications route", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications");

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ publications: [{ publicId: "pub_alpha" }] });
  });

  it("returns the four-part publication diff", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/diff");

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      metadata: { working: { title: "Working" }, approved: { title: "Approved" } },
      markdown: { working: "# Working", approved: "# Approved" },
      outgoingLinks: { working: ["pub_beta"], approved: [] },
      assets: { working: [{ publicPath: "/asset.png" }], approved: [] },
    });
  });

  it("returns diagnostics from the canonical diagnostics route", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/diagnostics");

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ diagnostics: [] });
  });

  it("inspects a vault-relative attachment without mutating review state", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/assets/inspect?path=public-assets%2Fguide.pdf");

    // Then
    expect(response.status).toBe(200);
    expect(service.inspectAsset).toHaveBeenCalledWith("public-assets/guide.pdf");
    expect(await response.json()).toMatchObject({
      sourcePath: "public-assets/guide.pdf",
      sha256: "sha256:asset",
      hashReviewed: false,
    });
  });

  it("returns a source update review for an explicit selector", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request(
      "/api/v1/publications/pub_alpha/source-update?sourceId=prv_source&referenceIndex=0&lines=4%3A8",
    );

    // Then
    expect(response.status).toBe(200);
    expect(service.sourceUpdate).toHaveBeenCalledWith("pub_alpha", {
      sourceId: "prv_source",
      referenceIndex: 0,
      lines: "4:8",
    });
    expect(await response.json()).toMatchObject({
      publicId: "pub_alpha",
      sourceId: "prv_source",
      referenceIndex: 0,
      expectedHash: `sha256:${"a".repeat(64)}`,
      canApply: true,
    });
  });

  it("applies only the explicitly submitted merged source body", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/source-update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "csrf-test",
      },
      body: JSON.stringify({
        sourceId: "prv_source",
        referenceIndex: 0,
        expectedHash: `sha256:${"a".repeat(64)}`,
        body: "# Reviewed merge\n\nPublic text only.",
        heading: "Public section",
      }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(service.applySourceUpdate).toHaveBeenCalledWith("pub_alpha", {
      sourceId: "prv_source",
      referenceIndex: 0,
      expectedHash: `sha256:${"a".repeat(64)}`,
      body: "# Reviewed merge\n\nPublic text only.",
      heading: "Public section",
    });
    expect(await response.json()).toEqual({
      publicId: "pub_alpha",
      path: "public-views/alpha.md",
      sourceHash: "sha256:merged",
    });
  });

  it("rejects ambiguous source selectors before calling the service", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request(
      "/api/v1/publications/pub_alpha/source-update?sourceId=prv_source&heading=One&lines=4%3A8",
    );

    // Then
    expect(response.status).toBe(400);
    expect(service.sourceUpdate).not.toHaveBeenCalled();
  });

  it("requires CSRF proof before applying a reviewed source merge", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/source-update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        sourceId: "prv_source",
        expectedHash: `sha256:${"a".repeat(64)}`,
        body: "# Reviewed merge",
      }),
    });

    // Then
    expect(response.status).toBe(403);
    expect(service.applySourceUpdate).not.toHaveBeenCalled();
  });

  it("rejects a mutation without same-origin and CSRF proof", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/approve", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      body: JSON.stringify({ expectedHash: "hash-working" }),
    });

    // Then
    expect(response.status).toBe(403);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("does not expose an arbitrary filesystem audit endpoint", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/audit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "csrf-test",
      },
      body: JSON.stringify({ path: "/home/private" }),
    });

    // Then
    expect(response.status).toBe(404);
    expect(service.audit).not.toHaveBeenCalled();
  });

  it("approves the exact expected exposure hash", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "csrf-test",
      },
      body: JSON.stringify({ expectedHash: "hash-working" }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(service.approve).toHaveBeenCalledWith("pub_alpha", "hash-working");
  });

  it("forwards the expected source file hash for candidate edits", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/candidates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "csrf-test",
      },
      body: JSON.stringify({
        path: "notes/alpha.md",
        kind: "knowledge",
        mode: "projection",
        expectedHash: "source-file-hash",
      }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(service.candidate).toHaveBeenCalledWith({
      path: "notes/alpha.md",
      kind: "knowledge",
      mode: "projection",
      expectedHash: "source-file-hash",
    });
  });

  it("updates reviewed metadata with the expected source hash", async () => {
    // Given
    const service = publisher();
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/metadata", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "csrf-test",
      },
      body: JSON.stringify({
        expectedHash: "source-file-hash",
        patch: {
          title: "Edited title",
          slug: "/knowledge/edited-title",
          summary: "Edited summary",
          tags: ["design", "review"],
          listed: false,
          index: true,
        },
      }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(service.updateMetadata).toHaveBeenCalledWith(
      "pub_alpha",
      {
        title: "Edited title",
        slug: "/knowledge/edited-title",
        summary: "Edited summary",
        tags: ["design", "review"],
        listed: false,
        index: true,
      },
      "source-file-hash",
    );
  });

  it("requires bearer authentication when remote access is configured", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://studio.local:3000",
      bearerToken: "remote-secret",
    });

    // When
    const response = await app.request("/api/v1/status");

    // Then
    expect(response.status).toBe(401);
  });

  it("returns preview HTML only inside a sandbox document contract", async () => {
    // Given
    const app = createDashboardApp({
      publisher: publisher(),
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_alpha/preview?mode=working");

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ html: "<h1>Preview</h1>" });
  });

  it("rejects a weak token before a non-loopback server can bind", () => {
    // Given
    const environment = { WIKAI_HOST: "0.0.0.0", WIKAI_TOKEN: "short" };

    // When
    const parse = () => parseServerConfig(environment);

    // Then
    expect(parse).toThrow();
  });

  it("does not expose unexpected internal error details", async () => {
    // Given
    const service = publisher();
    service.status = vi.fn(async () => {
      throw new Error("private vault path /home/secret/vault");
    });
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/status");

    // Then
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "The publisher could not complete the request" },
    });
  });

  it("preserves safe typed publisher errors", async () => {
    // Given
    const service = publisher();
    service.detail = vi.fn(async () => {
      throw new PublisherError("PUBLICATION_NOT_FOUND", "The publication was not found");
    });
    const app = createDashboardApp({
      publisher: service,
      csrfToken: "csrf-test",
      allowedOrigin: "http://127.0.0.1:3000",
    });

    // When
    const response = await app.request("/api/v1/publications/pub_missing");

    // Then
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PUBLICATION_NOT_FOUND", message: "The publication was not found" },
    });
  });
});
