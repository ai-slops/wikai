import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicMetadata, PublisherConfig } from "../model/index.ts";
import { auditDist } from "./index.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-policy-audit-"));
  await mkdir(join(root, "staging"), { recursive: true });
  await writeFile(
    join(root, "staging", "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
  await writeFile(
    join(root, "staging", "content-index.json"),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const config = (): PublisherConfig => ({
  schemaVersion: 1,
  vault: { root: join(root, "vault"), include: ["**/*.md"], exclude: [] },
  publisher: {
    stateDir: join(root, "state"),
    previewStagingDir: join(root, "preview"),
    releaseStagingDir: join(root, "staging"),
    cleanBuild: true,
  },
  publicViews: { roots: [] },
  assets: {
    roots: [],
    maxFileBytes: 1024,
    rejectSymlinks: true,
    stripImageMetadata: true,
    reviewedHashes: [],
  },
  security: {
    denyPatterns: [],
    scanPrivateIdsInDist: true,
    scanPrivatePathsInDist: true,
  },
  site: {
    sourceDir: join(root, "site"),
    distDir: join(root, "dist"),
    url: "https://example.test",
    isolatedBuild: true,
    network: "disabled",
    image: "wikai-site:test",
  },
  defaults: {
    work: { listed: true, index: true, feed: true },
    knowledge: { listed: true, index: true, feed: true },
    log: { listed: true, index: false, feed: true },
    page: { listed: false, index: true, feed: false },
  },
});

const metadata = (id: string, slug: string, index: boolean): PublicMetadata => ({
  id,
  kind: "knowledge",
  slug,
  title: id,
  tags: [],
  aliases: [],
  listed: true,
  index,
  feed: true,
  featured: false,
});

const writeDistPolicy = async (pages: readonly PublicMetadata[]): Promise<void> => {
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "dist", "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages }),
  );
  await writeFile(
    join(root, "dist", "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
};

describe("trusted distribution policy", () => {
  it("reports trusted routes and assets missing from rendered output", async () => {
    // Given staging declares a page and asset, when neither is rendered, then both omissions are reported.
    const approved = metadata("pub_missing", "/knowledge/missing", true);
    await writeFile(
      join(root, "staging", "publication-manifest.json"),
      JSON.stringify({ schemaVersion: 1, pages: [approved] }),
    );
    await writeFile(
      join(root, "staging", "content-index.json"),
      JSON.stringify({
        schemaVersion: 1,
        pages: [{ assets: [{ publicPath: "/assets/approved.png", hash: "sha256:asset" }] }],
      }),
    );
    await writeDistPolicy([approved]);
    const codes = (await auditDist(join(root, "dist"), config())).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining(["AUDIT_EXPECTED_ROUTE_MISSING", "AUDIT_EXPECTED_ASSET_MISSING"]),
    );
  });

  it("enforces sitemap and noindex policy from trusted metadata", async () => {
    // Given indexed and excluded pages with inverted renderer policy, when audited, then sitemap and robots drift is rejected.
    const indexed = metadata("pub_indexed", "/knowledge/indexed", true);
    const excluded = metadata("pub_excluded", "/knowledge/excluded", false);
    const pages = [indexed, excluded];
    await writeFile(
      join(root, "staging", "publication-manifest.json"),
      JSON.stringify({ schemaVersion: 1, pages }),
    );
    await writeDistPolicy(pages);
    for (const page of pages) {
      const path = join(root, "dist", page.slug.slice(1), "index.html");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        page.index ? '<meta name="robots" content="noindex">' : "<html></html>",
      );
    }
    await writeFile(
      join(root, "dist", "sitemap-0.xml"),
      `<urlset><url><loc>https://example.test${excluded.slug}</loc></url></urlset>`,
    );
    const codes = (await auditDist(join(root, "dist"), config())).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "AUDIT_SITEMAP_MISSING",
        "AUDIT_SITEMAP_FORBIDDEN",
        "AUDIT_NOINDEX_MISMATCH",
      ]),
    );
  });
});
