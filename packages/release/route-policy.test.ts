import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovedRevision, PublisherConfig } from "../model/index.ts";
import { ConfigSchema } from "../model/index.ts";
import { buildReleaseStaging } from "./index.ts";

let root: string;
let config: PublisherConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-release-routes-"));
  config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: join(root, "release"),
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const revision = (slug: string): ApprovedRevision => ({
  publicId: "pub_route",
  revisionHash: "revision",
  exposureHash: "exposure",
  metadata: {
    id: "pub_route",
    kind: "page",
    slug,
    title: "Route",
    tags: [],
    aliases: [],
    listed: false,
    index: true,
    feed: false,
    featured: false,
    page: { layout: "generic" },
  },
  markdown: "Route body.",
  html: "<p>Route body.</p>",
  outgoingLinks: [],
  assets: [],
  approvedAt: "2026-01-01T00:00:00Z",
});

describe("release route policy", () => {
  it("rejects a renderer-owned generated route", async () => {
    // Given a persisted revision colliding with the renderer's search page.
    // When staged, then release fails closed even if older state bypassed the compiler.
    await expect(buildReleaseStaging([revision("/search")], config)).rejects.toMatchObject({
      code: "RELEASE_INVALID_ROUTE",
    });
  });

  it("rejects a redirect from a renderer-owned route", async () => {
    // Given a valid page and an alias redirect that would shadow generated output.
    const page = revision("/company");

    // When staged, then aliases cannot take ownership of renderer routes.
    await expect(
      buildReleaseStaging([page], config, [{ from: "/search", to: "/company", status: 301 }]),
    ).rejects.toMatchObject({ code: "RELEASE_INVALID_REDIRECT" });
  });

  it("rejects case-insensitive route collisions", async () => {
    // Given two approved routes that differ only by case.
    const second = {
      ...revision("/Company"),
      publicId: "pub_second",
      metadata: { ...revision("/Company").metadata, id: "pub_second" },
    };

    // When staged, then filesystem-host-dependent collisions fail consistently.
    await expect(buildReleaseStaging([revision("/company"), second], config)).rejects.toMatchObject(
      {
        code: "RELEASE_DUPLICATE_ROUTE",
      },
    );
  });
});
