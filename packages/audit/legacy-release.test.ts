import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PublisherConfig } from "../model/index.ts";
import { buildReleaseStaging } from "../release/index.ts";
import { decodeRevision } from "../state/revision.ts";
import { auditDist } from "./index.ts";

const revisionHash = "sha256:2a27f26c6b8cfb72c52e14b546b82bc0c811a717b31713d70afb61526baa8276";
const legacyRevision = `{
  "publicId": "pub_legacy",
  "revisionHash": "${revisionHash}",
  "exposureHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "metadata": {
    "id": "pub_legacy",
    "kind": "work",
    "slug": "/work/legacy",
    "title": "Legacy",
    "tags": [],
    "aliases": [],
    "listed": true,
    "index": true,
    "feed": true,
    "featured": false,
    "publishedAt": "publication season",
    "work": { "startedAt": "spring2024" }
  },
  "markdown": "# Legacy\\n",
  "html": "<h1>Legacy</h1>",
  "outgoingLinks": [],
  "assets": [],
  "approvedAt": "approval day",
  "integrityHash": "sha256:e1866841d8deadcbfb3304bbfe757df517875f16a5be36bd36a4c8cb04ca88fd"
}`;

const fixedFiles = [
  "index.html",
  "about/index.html",
  "now/index.html",
  "contact/index.html",
  "search/index.html",
  "work/index.html",
  "knowledge/index.html",
  "log/index.html",
  "feed.xml",
  "work.xml",
  "knowledge.xml",
  "log.xml",
  "feeds/all.xml",
  "feeds/work.xml",
  "feeds/knowledge.xml",
  "feeds/log.xml",
  "sitemap-0.xml",
  "sitemap-index.xml",
  "robots.txt",
] as const;

let root: string;

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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-legacy-release-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("audits a release built from immutable legacy revision bytes", async () => {
  const input = config();
  const revision = decodeRevision(legacyRevision, "pub_legacy", revisionHash);
  await buildReleaseStaging([revision], input);
  const stagedBytes = await readFile(join(input.publisher.releaseStagingDir, "content-index.json"));
  const rendered = join(root, "dist");
  await Promise.all(
    fixedFiles.map(async (relativePath) => {
      const path = join(rendered, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        relativePath === "sitemap-0.xml"
          ? "<urlset><url><loc>https://example.test/work/legacy</loc></url></urlset>"
          : "public",
      );
    }),
  );
  const route = join(rendered, "work/legacy/index.html");
  await mkdir(dirname(route), { recursive: true });
  await writeFile(route, "<html><body>Legacy</body></html>");
  for (const policyFile of ["publication-manifest.json", "redirects.json"] as const) {
    await writeFile(
      join(rendered, policyFile),
      await readFile(join(input.publisher.releaseStagingDir, policyFile)),
    );
  }

  const diagnostics = await auditDist(rendered, input);

  expect(await readFile(join(input.publisher.releaseStagingDir, "content-index.json"))).toEqual(
    stagedBytes,
  );
  expect(diagnostics).toEqual([]);
});
