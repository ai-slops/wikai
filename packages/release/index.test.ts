import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { ApprovedRevision, PublisherConfig } from "../model/index.ts";
import { buildReleaseStaging, buildSite, createExportSpec, createSandboxSpec } from "./index.ts";

let root: string;
const originalEnvironment = { ...process.env };
const originalPath = Object.entries(originalEnvironment).find(([key]) => key === "PATH")?.[1];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-release-"));
});
afterEach(async () => {
  process.env = { ...originalEnvironment };
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
  publicViews: { roots: ["public-views"] },
  assets: {
    roots: ["assets"],
    maxFileBytes: 1024,
    rejectSymlinks: true,
    stripImageMetadata: true,
    reviewedHashes: [],
  },
  security: {
    denyPatterns: ["PRIVATE_SENTINEL_[A-Z0-9_]+"],
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

const revision = (
  publicId: string,
  slug: string,
  links: ApprovedRevision["outgoingLinks"] = [],
): ApprovedRevision => ({
  publicId,
  revisionHash: hash(`rev-${publicId}`),
  exposureHash: `exp-${publicId}`,
  metadata: {
    id: publicId,
    kind: "knowledge",
    slug,
    title: slug,
    tags: [],
    aliases: [],
    listed: true,
    index: true,
    feed: true,
    featured: false,
  },
  markdown: `# ${slug}`,
  html: `<h1>${slug}</h1>`,
  outgoingLinks: links,
  assets: [],
  approvedAt: "2026-01-01T00:00:00.000Z",
});

describe("release staging", () => {
  it("reconstructs public backlinks without revision or source fields", async () => {
    // Given two immutable approved revisions, when staging is built, then only the public contract is materialized.
    const first = revision("pub_first", "/knowledge/first", [
      { publicId: "pub_second", slug: "/knowledge/second", title: "second" },
    ]);
    const manifest = await buildReleaseStaging(
      [first, revision("pub_second", "/knowledge/second")],
      config(),
    );
    const raw = await readFile(join(root, "staging", "content-index.json"), "utf8");
    const markdown = await readFile(
      join(root, "staging", "content", "knowledge", "first.md"),
      "utf8",
    );
    const search = await readFile(join(root, "staging", "search-index.json"), "utf8");
    const privateIdentity = await readFile(join(root, "state", "release-input.json"), "utf8");
    const index: unknown = JSON.parse(raw);
    expect(manifest.pages).toHaveLength(2);
    expect(raw).not.toContain("revisionHash");
    expect(raw).not.toContain("approvedAt");
    expect(markdown).toBe("# /knowledge/first");
    expect(search).not.toContain("revisionHash");
    expect(privateIdentity).toContain(first.revisionHash);
    expect(
      await readFile(join(root, "staging", "publication-manifest.json"), "utf8"),
    ).not.toContain(first.revisionHash);
    expect(index).toMatchObject({
      pages: [
        { backlinks: [] },
        {
          backlinks: [
            { publicId: "pub_first", slug: "/knowledge/first", title: "/knowledge/first" },
          ],
        },
      ],
    });
  });

  it("rejects dangling links before replacing trusted staging", async () => {
    // Given an approved revision linking outside the approved graph, when staging is built, then the release is refused.
    const page = revision("pub_first", "/knowledge/first", [
      { publicId: "pub_missing", slug: "/knowledge/missing", title: "missing" },
    ]);
    await expect(buildReleaseStaging([page], config())).rejects.toMatchObject({
      code: "RELEASE_DANGLING_LINK",
    });
  });

  it("rejects private sentinels before materializing staging", async () => {
    // Given an approved payload containing a deny-pattern sentinel, when staging is built, then the release is refused.
    const page = {
      ...revision("pub_first", "/knowledge/first"),
      html: "<p>PRIVATE_SENTINEL_ALPHA</p>",
    };
    await expect(buildReleaseStaging([page], config())).rejects.toMatchObject({
      code: "RELEASE_STAGING_AUDIT_FAILED",
    });
  });

  it("defines a read-only networkless least-privilege renderer", () => {
    // Given isolated build configuration, when the container spec is created, then every required sandbox control is present.
    const spec = createSandboxSpec(config(), "wikai-build-test");
    expect(spec.createArgs).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
      ]),
    );
    expect(spec.createArgs.join(" ")).not.toContain(config().vault.root);
    expect(spec.createArgs.join(" ")).not.toContain("/home");
  });

  it("defines a read-only networkless least-privilege exporter", () => {
    // Given a rendered volume, when the export helper is specified, then it cannot access the network or gain privileges.
    const args = createExportSpec("wikai-export-test", "wikai-dist-test", "wikai-site:test");
    expect(args).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
      ]),
    );
    expect(args).toEqual(
      expect.arrayContaining(["--mount", "type=volume,src=wikai-dist-test,dst=/dist,readonly"]),
    );
  });

  it("checks the finite renderer exit code and preserves the previous dist on failure", async () => {
    // Given an existing dist and a renderer that exits nonzero, when building, then export is skipped and the old dist remains.
    const bin = join(root, "bin");
    const log = join(root, "docker.log");
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "docker"),
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.WIKAI_FAKE_DOCKER_LOG, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "wait") process.stdout.write("17\\n");
`,
    );
    await chmod(join(bin, "docker"), 0o755);
    process.env = {
      ...process.env,
      PATH: `${bin}:${originalPath ?? ""}`,
      WIKAI_FAKE_DOCKER_LOG: log,
    };
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "existing.txt"), "preserve me");
    await buildReleaseStaging([], config());
    await expect(buildSite(config())).rejects.toMatchObject({ code: "RELEASE_BUILD_FAILED" });
    const invocations = await readFile(log, "utf8");
    expect(invocations).toContain("wait wikai-site-");
    expect(invocations).not.toContain(" exec ");
    expect(invocations).not.toContain("-export --network");
    expect(await readFile(join(root, "dist", "existing.txt"), "utf8")).toBe("preserve me");
  });
});
