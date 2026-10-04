import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSchema, type PublisherConfig, type VaultSnapshot } from "../model/index.ts";
import { auditDist } from "./index.ts";

let root: string;
let config: PublisherConfig;

const vault: VaultSnapshot = {
  documents: [
    {
      sourcePath: "people/alice/private-note.md",
      sourceHash: "hash",
      raw: "",
      body: "",
      frontmatter: { id: "prv_secret", aliases: [] },
      headings: [],
    },
  ],
  diagnostics: [],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-filename-audit-"));
  config = ConfigSchema.parse({
    vault: { root: join(root, "vault") },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: join(root, "staging"),
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
  await mkdir(config.publisher.releaseStagingDir);
  await mkdir(config.site.distDir);
  for (const file of ["publication-manifest.json", "content-index.json"]) {
    await writeFile(
      join(config.publisher.releaseStagingDir, file),
      JSON.stringify({ schemaVersion: 1, pages: [] }),
    );
  }
  await writeFile(
    join(config.publisher.releaseStagingDir, "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
  await writeFile(
    join(config.site.distDir, "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
  );
  await writeFile(
    join(config.site.distDir, "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
  for (const route of [
    "",
    "about/",
    "now/",
    "contact/",
    "search/",
    "work/",
    "knowledge/",
    "log/",
  ]) {
    const path = join(config.site.distDir, route, "index.html");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "public");
  }
  for (const file of [
    "feed.xml",
    "work.xml",
    "knowledge.xml",
    "log.xml",
    "sitemap-0.xml",
    "sitemap-index.xml",
    "robots.txt",
  ]) {
    await writeFile(join(config.site.distDir, file), "public");
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("distribution filename privacy", () => {
  it("accepts the safe baseline before any filename leak is introduced", async () => {
    expect(await auditDist(config.site.distDir, config, vault)).toEqual([]);
  });

  it.each([
    ["_assets/prv_secret.js", "AUDIT_PRIVATE_ID"],
    ["_assets/people/alice/private-note.md.js", "AUDIT_PRIVATE_PATH"],
    ["_assets/people%2Falice%2Fprivate-note.md.css", "AUDIT_PRIVATE_PATH"],
    ["_assets/PRIVATE_SENTINEL_FILENAME.png", "AUDIT_DENY_PATTERN"],
    ["_assets/ghp_abcdefghijklmnopqrstuvwxyz1234567890.woff2", "AUDIT_SECRET"],
    ["_assets/pub_unapproved.js", "AUDIT_UNAPPROVED_PUBLIC_ID"],
  ])("rejects sensitive output name %s even with harmless contents", async (name, code) => {
    // Given a generated asset whose name alone exposes private information.
    const path = join(config.site.distDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "harmless public content");

    // When the real filesystem output is audited, including non-text extensions.
    const diagnostics = await auditDist(config.site.distDir, config, vault);

    // Then the privacy violation is blocking, not merely an unexpected-file error.
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code, severity: "error", sourcePath: name }),
    );
    expect(diagnostics.some((item) => item.code === "AUDIT_UNEXPECTED_FILE")).toBe(false);
  });

  it("does not treat a private parent directory as part of a public asset name", async () => {
    // Given a safe public asset under a locally named private output directory.
    const dist = join(root, "prv_secret", "dist");
    await mkdir(join(dist, "_assets"), { recursive: true });
    await writeFile(join(dist, "_assets", "safe.js"), "harmless public content");

    // When scanning the output surface, not its non-public absolute location.
    const diagnostics = await auditDist(dist, config, vault);

    // Then no private identifier is inferred from the parent directory.
    expect(diagnostics.some((item) => item.code === "AUDIT_PRIVATE_ID")).toBe(false);
  });
});
