import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApprovedRevision, ConfigSchema, type PublisherConfig } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

let root: string;
let config: PublisherConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-compiler-"));
  await mkdir(join(root, "public-views"));
  await mkdir(join(root, "assets"));
  config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
      cleanBuild: true,
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const approved = (
  publicId: string,
  title: string,
  slug: string,
  headings: string[] = [],
): ApprovedRevision => ({
  publicId,
  revisionHash: `revision-${publicId}`,
  exposureHash: `exposure-${publicId}`,
  metadata: {
    id: publicId,
    kind: "knowledge",
    title,
    slug: `/knowledge/${slug}`,
    tags: headings,
    aliases: [],
    listed: true,
    index: true,
    feed: true,
    featured: false,
  },
  markdown: headings.map((heading) => `## ${heading}`).join("\n"),
  html: headings.map((heading) => `<h2 id="${heading.toLowerCase()}">${heading}</h2>`).join(""),
  outgoingLinks: [],
  assets: [],
  approvedAt: "2026-01-01T00:00:00Z",
});

describe("secure compiler", () => {
  it("compiles mirror and projection documents while keeping ordinary notes private", async () => {
    // Given two explicitly public documents and one ordinary private note.
    await writeFile(
      join(root, "mirror.md"),
      "---\nid: prv_mirror\ntitle: Private title\nsecret: hidden\npublic:\n  id: pub_mirror\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Public title\n  privateNested: hidden\n---\n# Public title\nSee [the guide](Guide.md#Install) and [[Guide#Install|setup]].\n",
    );
    await writeFile(
      join(root, "private.md"),
      "---\nid: prv_private\n---\nPRIVATE_SENTINEL_HIDDEN\n",
    );
    await writeFile(
      join(root, "public-views", "projection.md"),
      "---\nid: prv_projection\npublic:\n  id: pub_projection\n  status: candidate\n  mode: projection\n  kind: page\n  page:\n    layout: generic\n  slug: /projected\n  title: Projected\n---\nOnly curated text.\n",
    );

    // When the complete vault is compiled against an approved link target.
    const plan = await compile(await loadVault(config), config, [
      approved("pub_guide", "Guide", "guide", ["Install"]),
    ]);

    // Then only explicit publications exist and private metadata/body stay absent.
    expect(plan.publications.map(({ publicId }) => publicId)).toEqual([
      "pub_mirror",
      "pub_projection",
    ]);
    expect(plan.publications[0]?.markdown).toContain("[the guide](/knowledge/guide#install)");
    expect(plan.publications[0]?.markdown).toContain("[setup](/knowledge/guide#install)");
    expect(JSON.stringify(plan)).not.toContain("PRIVATE_SENTINEL_HIDDEN");
    expect(JSON.stringify(plan)).not.toContain("secret");
    expect(JSON.stringify(plan)).not.toContain("privateNested");
    expect(plan.publications[0]?.html).toContain('id="public-title"');
    expect(plan.diagnostics).toEqual([]);
  });

  it("rejects unapproved revisions even when their frontmatter says published", async () => {
    // Given a source linking to a published-looking but unapproved private target.
    await writeFile(
      join(root, "source.md"),
      "---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Source\n---\n[secret](private.md)\n",
    );
    await writeFile(
      join(root, "private.md"),
      "---\nid: prv_private\ntitle: Private\npublic:\n  id: pub_private\n  status: published\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n---\nprivate\n",
    );

    // When compiling without an approved target.
    const plan = await compile(await loadVault(config), config);

    // Then the source publication is blocked by the unapproved revision.
    expect(plan.publications.map(({ publicId }) => publicId)).toEqual(["pub_private"]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNAPPROVED_REVISION",
        publicId: "pub_source",
        severity: "error",
      }),
    );
  });

  it("resolves an approved target through its underlying private vault path", async () => {
    // Given a private-path link whose target has an approved revision with different public metadata.
    await writeFile(
      join(root, "source.md"),
      "---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Source\n---\n[explicit label](private.md#Approved)\n",
    );
    await writeFile(
      join(root, "private.md"),
      "---\nid: prv_private\ntitle: Private working title\npublic:\n  id: pub_private\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n---\n# Working heading\n",
    );

    // When compiling with the target's immutable approved revision.
    const plan = await compile(await loadVault(config), config, [
      approved("pub_private", "Approved title", "approved-path", ["Approved"]),
    ]);

    // Then routing and outgoing metadata come only from the approved target.
    const source = plan.publications.find(({ publicId }) => publicId === "pub_source");
    expect(source?.markdown).toContain("[explicit label](/knowledge/approved-path#approved)");
    expect(source?.outgoingLinks).toEqual([
      {
        publicId: "pub_private",
        slug: "/knowledge/approved-path",
        title: "Approved title",
        anchor: "approved",
      },
    ]);
  });

  it.each([
    [
      "private target",
      "private.md",
      "---\nid: prv_private\ntitle: Private\n---\nbody\n",
      "PRIVATE_TARGET_LINK",
    ],
    ["missing target", "missing.md", undefined, "UNRESOLVED_INTERNAL_LINK"],
  ])("distinguishes a %s", async (_case, target, targetBody, code) => {
    // Given an internal link and, optionally, a wholly private target.
    await writeFile(
      join(root, "source.md"),
      `---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Source\n---\n[target](${target})\n`,
    );
    if (targetBody) await writeFile(join(root, "private.md"), targetBody);

    // When compiled, then the diagnostic identifies the exact trust-boundary failure.
    const plan = await compile(await loadVault(config), config);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code, publicId: "pub_source" }),
    );
  });

  it("reports ambiguous private titles before considering approval", async () => {
    // Given two vault notes with the same title and a title-based link.
    await writeFile(join(root, "a.md"), "---\nid: prv_a\ntitle: Same\n---\na\n");
    await writeFile(join(root, "b.md"), "---\nid: prv_b\ntitle: Same\n---\nb\n");
    await writeFile(
      join(root, "source.md"),
      "---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Source\n---\n[[Same]]\n",
    );

    // When compiled, then title ambiguity blocks the publication.
    const plan = await compile(await loadVault(config), config);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_INTERNAL_LINK" }),
    );
  });

  it("prioritizes an exact private ID over duplicate titles", async () => {
    // Given duplicate private titles but an exact private-ID link to an approved target.
    await writeFile(
      join(root, "a.md"),
      "---\nid: prv_a\ntitle: Same\npublic:\n  id: pub_a\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n---\n# Approved\n",
    );
    await writeFile(join(root, "b.md"), "---\nid: prv_b\ntitle: Same\n---\nb\n");
    await writeFile(
      join(root, "source.md"),
      "---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Source\n---\n[[prv_a]]\n",
    );

    // When compiled, then private ID wins before the ambiguous title tier.
    const plan = await compile(await loadVault(config), config, [
      approved("pub_a", "Approved", "approved"),
    ]);
    const source = plan.publications.find(({ publicId }) => publicId === "pub_source");
    expect(source?.markdown).toContain("[Approved](/knowledge/approved)");
  });

  it("keeps exposure hashes stable for private-only and timestamp changes", async () => {
    // Given a public note with private frontmatter and a public review timestamp.
    const path = join(root, "stable.md");
    await writeFile(
      path,
      "---\nid: prv_stable\nprivateValue: one\npublic:\n  id: pub_stable\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Stable\n  lastVerifiedAt: 2026-01-01\n---\nStable body.\n",
    );
    const first = await compile(await loadVault(config), config);

    // When only non-exposure values change.
    await writeFile(
      path,
      "---\nid: prv_stable\nprivateValue: two\npublic:\n  id: pub_stable\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Stable\n  lastVerifiedAt: 2026-09-19\n---\nStable body.\n",
    );
    const second = await compile(await loadVault(config), config);

    // Then approval identity remains stable.
    expect(first.publications[0]?.exposureHash).toBe(second.publications[0]?.exposureHash);
  });

  it("generates canonical absolute Unicode paths without double-prefixing links", async () => {
    // Given a Unicode-titled document and an approved absolute target path.
    await writeFile(
      join(root, "unicode.md"),
      "---\nid: prv_unicode\npublic:\n  id: pub_unicode\n  status: review\n  mode: mirror\n  kind: knowledge\n  knowledge:\n    documentType: topic\n  title: Café 指南\n---\n[guide](Guide.md)\n",
    );

    // When compiled, then generated and rewritten URLs are canonical absolute paths.
    const plan = await compile(await loadVault(config), config, [
      approved("pub_guide", "Guide", "guide"),
    ]);
    expect(plan.publications[0]?.metadata.slug).toBe("/knowledge/café-指南");
    expect(plan.publications[0]?.markdown).toContain("[guide](/knowledge/guide)");
    expect(plan.publications[0]?.markdown).not.toContain("/knowledge//knowledge/");
  });

  it("requires every publication source to have a private ID", async () => {
    // Given otherwise valid public frontmatter without a private source ID.
    await writeFile(
      join(root, "missing-id.md"),
      "---\npublic:\n  id: pub_missing_id\n  status: review\n  mode: mirror\n  kind: knowledge\n  title: Missing ID\n---\nbody\n",
    );

    // When compiled, then the source is blocked with a stable non-excerpt diagnostic.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_ID_REQUIRED" }),
    );
  });

  it.each(["work", "knowledge", "log", "page"])(
    "requires kind-specific metadata for %s publications",
    async (kind) => {
      // Given a publication without its kind-required nested metadata.
      await writeFile(
        join(root, `${kind}.md`),
        `---\nid: prv_kind\npublic:\n  id: pub_kind\n  status: review\n  mode: mirror\n  kind: ${kind}\n  title: Kind\n---\nbody\n`,
      );

      // When compiled, then invalid kind metadata is blocked.
      const plan = await compile(await loadVault(config), config);
      expect(plan.publications).toEqual([]);
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({ code: "PUBLIC_KIND_METADATA_REQUIRED" }),
      );
    },
  );
});
