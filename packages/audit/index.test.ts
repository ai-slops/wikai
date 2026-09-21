import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicMetadata, PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { auditDist } from "./index.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-audit-"));
  await mkdir(join(root, "staging"), { recursive: true });
  await writeFile(
    join(root, "staging", "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
  );
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

const vault: VaultSnapshot = {
  documents: [
    {
      sourcePath: "people/alice/private-note.md",
      sourceHash: "hash",
      raw: "---\nid: prv_secret\n---\nprivate",
      body: "private",
      frontmatter: { id: "prv_secret", aliases: [] },
      headings: [],
    },
  ],
  diagnostics: [],
};

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

const writePublicFiles = async (canonicalFeeds = true): Promise<void> => {
  await Promise.all(
    fixedFiles
      .filter((relative) => canonicalFeeds || !relative.startsWith("feeds/"))
      .map(async (relative) => {
        const path = join(root, "dist", relative);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "public");
      }),
  );
  await writeFile(
    join(root, "dist", "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
  );
  await writeFile(
    join(root, "dist", "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
};

describe("distribution privacy audit", () => {
  it("reports private identifiers, paths, sentinels, secrets, maps, and unexpected files", async () => {
    // Given a rendered output containing multiple leak classes, when audited, then every class is reported.
    await mkdir(join(root, "dist"), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "dist", "index.html"),
        "prv_secret people/alice/private-note.md PRIVATE_SENTINEL_ALPHA ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      ),
      writeFile(join(root, "dist", "app.js.map"), "{}"),
      writeFile(join(root, "dist", "vault.db"), "private"),
    ]);
    const codes = (await auditDist(join(root, "dist"), config(), vault)).map(
      (diagnostic) => diagnostic.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "AUDIT_PRIVATE_ID",
        "AUDIT_PRIVATE_PATH",
        "AUDIT_DENY_PATTERN",
        "AUDIT_SECRET",
        "AUDIT_SOURCE_MAP",
        "AUDIT_UNEXPECTED_FILE",
      ]),
    );
  });

  it("accepts the complete static public route surface", async () => {
    // Given the required public routes and feeds, when audited, then no error diagnostic is returned.
    await writePublicFiles();
    expect(
      (await auditDist(join(root, "dist"), config())).filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
  });

  it("accepts legacy feeds before canonical feed generation is available", async () => {
    // Given the retained root feeds without canonical aliases, when audited, then the transition remains valid.
    await writePublicFiles(false);
    expect(
      (await auditDist(join(root, "dist"), config())).filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
  });

  it("rejects renderer-created routes and policy drift even with allowed extensions", async () => {
    // Given a renderer that adds an undeclared page and changes its manifest, when audited, then trusted staging remains authoritative.
    const files = [...fixedFiles, "extra/index.html"];
    await Promise.all(
      files.map(async (relative) => {
        const path = join(root, "dist", relative);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "public");
      }),
    );
    await writeFile(
      join(root, "dist", "publication-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        pages: [
          {
            id: "pub_extra",
            kind: "page",
            slug: "/extra",
            title: "Extra",
            tags: [],
            aliases: [],
            listed: false,
            index: true,
            feed: false,
            featured: false,
          },
        ],
      }),
    );
    await writeFile(
      join(root, "dist", "redirects.json"),
      JSON.stringify({ schemaVersion: 1, redirects: [] }),
    );
    const codes = (await auditDist(join(root, "dist"), config())).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining(["AUDIT_ROUTE_POLICY_MISMATCH", "AUDIT_UNEXPECTED_ROUTE"]),
    );
  });

  it("scans absolute configured vault paths without a vault snapshot", async () => {
    // Given configured root and local vault paths but no optional index, when either leaks, then both are detected.
    await writePublicFiles();
    const input = config();
    const local = join(root, "vault-local");
    Object.assign(input.vault, { local });
    await writeFile(join(root, "dist", "index.html"), `${input.vault.root}\n${local}`);
    const codes = (await auditDist(join(root, "dist"), input)).map((item) => item.code);
    expect(codes.filter((code) => code === "AUDIT_PRIVATE_PATH")).toHaveLength(1);
  });

  it("rejects public identifiers absent from trusted staging", async () => {
    // Given one approved and one renderer-invented public ID, when audited, then only the invented ID is rejected.
    const approved = metadata("pub_approved", "/knowledge/approved", true);
    await writeFile(
      join(root, "staging", "publication-manifest.json"),
      JSON.stringify({ schemaVersion: 1, pages: [approved] }),
    );
    await writePublicFiles();
    await writeFile(
      join(root, "dist", "publication-manifest.json"),
      JSON.stringify({ schemaVersion: 1, pages: [approved] }),
    );
    await writeFile(join(root, "dist", "index.html"), "pub_approved pub_invented");
    const diagnostics = await auditDist(join(root, "dist"), config());
    expect(diagnostics.filter((item) => item.code === "AUDIT_UNAPPROVED_PUBLIC_ID")).toMatchObject([
      { sourcePath: "index.html" },
    ]);
  });
});
