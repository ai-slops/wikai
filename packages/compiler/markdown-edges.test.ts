import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApprovedRevision, ConfigSchema, type PublisherConfig } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

let root: string;
let config: PublisherConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-markdown-edges-"));
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

const approved = (): ApprovedRevision => ({
  publicId: "pub_target",
  revisionHash: "revision",
  exposureHash: "exposure",
  metadata: {
    id: "pub_target",
    kind: "knowledge",
    title: "Approved target",
    slug: "/knowledge/approved-target",
    tags: [],
    aliases: [],
    listed: true,
    index: true,
    feed: true,
    featured: false,
  },
  markdown: "## Security model",
  html: '<h2 id="security-model">Security model</h2>',
  outgoingLinks: [],
  assets: [],
  approvedAt: "2026-01-01T00:00:00Z",
});

const publicNote = (body: string): string =>
  `---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/source\n  title: Source\n  summary: Markdown source\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n${body}\n`;

describe("Markdown edge security", () => {
  it("resolves reference-style links and slugifies raw-space headings", async () => {
    // Given a reference-style link to an approved heading written with raw spaces.
    await writeFile(
      join(root, "source.md"),
      publicNote("[review][target]\n\n[target]: <Target.md#Security model>"),
    );
    await writeFile(
      join(root, "Target.md"),
      "---\nid: prv_target\ntitle: Working target\npublic:\n  id: pub_target\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/working-target\n  summary: Working target\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\nworking\n",
    );

    // When compiled, then the reference is converted to the approved canonical link.
    const plan = await compile(await loadVault(config), config, [approved()]);
    const source = plan.publications.find(({ publicId }) => publicId === "pub_source");
    expect(source?.markdown).toContain("[review](/knowledge/approved-target#security-model)");
  });

  it.each(["![pixel][asset]\n\n[asset]: assets/pixel.png", "![[assets/pixel.png|pixel]]"])(
    "sanitizes local image form %s",
    async (body) => {
      // Given a local raster referenced through non-inline image syntax.
      await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
        .withMetadata({ orientation: 6 })
        .png()
        .toFile(join(root, "assets", "pixel.png"));
      await writeFile(join(root, "source.md"), publicNote(body));

      // When compiled, then it is decoded, sanitized, and content-addressed.
      const plan = await compile(await loadVault(config), config);
      expect(plan.publications[0]?.assets[0]).toMatchObject({ mime: "image/png", reviewed: true });
      expect(plan.publications[0]?.markdown).toMatch(/!\[pixel\]\(\/assets\/[a-f0-9]{64}\.png\)/u);
    },
  );

  it("sniffs an extensionless local raster asset", async () => {
    // Given a valid image stored without a filename extension.
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } })
      .png()
      .toFile(join(root, "assets", "pixel"));
    await writeFile(join(root, "source.md"), publicNote("![pixel](assets/pixel)"));

    // When compiled, then content sniffing recognizes and sanitizes it.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications[0]?.assets[0]).toMatchObject({ mime: "image/png" });
  });

  it.each(["publish", "published", "publication"])(
    "diagnoses accidental %s frontmatter instead of treating it as private",
    async (key) => {
      // Given a near-miss public frontmatter key.
      await writeFile(join(root, "mistake.md"), `---\nid: prv_mistake\n${key}: true\n---\nbody\n`);

      // When loaded, then the author receives an actionable diagnostic.
      const vault = await loadVault(config);
      expect(vault.diagnostics).toContainEqual(
        expect.objectContaining({ code: "FRONTMATTER_PUBLIC_KEY_INVALID" }),
      );
    },
  );

  it("blocks built-in credential signatures without custom deny patterns", async () => {
    // Given an otherwise public note containing an AWS access-key signature.
    await writeFile(join(root, "source.md"), publicNote("AKIAABCDEFGHIJKLMNOP"));

    // When compiled, then the publication is blocked without echoing the credential.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_SECRET_DETECTED" }),
    );
    expect(JSON.stringify(plan.diagnostics)).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it.each([
    ["canonical", "  canonical: javascript:alert(1)\n", ""],
    [
      "work link",
      "",
      "  work:\n    role: Engineer\n    projectStatus: active\n    links:\n      - label: unsafe\n        url: file:///etc/passwd\n",
    ],
  ])("blocks an unsafe %s URL", async (_case, canonical, kindMetadata) => {
    // Given metadata containing a non-HTTP public URL.
    const kind = kindMetadata ? "work" : "knowledge";
    const nested = kindMetadata || "  knowledge:\n    documentType: topic\n";
    await writeFile(
      join(root, "unsafe-url.md"),
      `---\nid: prv_unsafe_url\npublic:\n  id: pub_unsafe_url\n  status: review\n  mode: mirror\n  kind: ${kind}\n  slug: /${kind}/unsafe-url\n  summary: Unsafe URL\n  contentState: stable\n${nested}${canonical}  title: Unsafe URL\n---\nbody\n`,
    );

    // When compiled, then URL parsing blocks the publication with a stable diagnostic.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_URL_INVALID", publicId: "pub_unsafe_url" }),
    );
  });

  it("removes every adjacent HTML comment from public Markdown", async () => {
    // Given consecutive private comments before visible content.
    await writeFile(
      join(root, "source.md"),
      publicNote("<!-- first -->\n\n<!-- private note -->\n\nVisible"),
    );

    // When compiled, then no comment survives AST sanitization.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications[0]?.markdown).toContain("Visible");
    expect(plan.publications[0]?.markdown).not.toContain("<!--");
    expect(plan.publications[0]?.markdown).not.toContain("private note");
  });

  it("removes nested reference definitions after rewriting their links", async () => {
    // Given a definition nested in a blockquote and referenced outside it.
    await writeFile(join(root, "source.md"), publicNote("> [guide]: Target.md\n\n[read][guide]"));
    await writeFile(
      join(root, "Target.md"),
      "---\nid: prv_target\ntitle: Working target\npublic:\n  id: pub_target\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/working-target\n  summary: Working target\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\nworking\n",
    );

    // When compiled, then the private definition is absent and the approved URL remains.
    const plan = await compile(await loadVault(config), config, [approved()]);
    const source = plan.publications.find(({ publicId }) => publicId === "pub_source");
    expect(source?.markdown).toContain("[read](/knowledge/approved-target)");
    expect(source?.markdown).not.toContain("Target.md");
    expect(source?.markdown).not.toContain("[guide]:");
  });

  it("resolves a public-ID self-link when the same page already has an approval", async () => {
    // Given an update that links to its own public ID and has a prior approved revision.
    await writeFile(join(root, "source.md"), publicNote("[self](pub_source)"));
    const prior = approved();
    const selfApproval: ApprovedRevision = {
      ...prior,
      publicId: "pub_source",
      metadata: {
        ...prior.metadata,
        id: "pub_source",
        title: "Old source",
        slug: "/knowledge/source",
      },
    };

    // When compiled, then the self-link is unambiguous and uses the working page target.
    const plan = await compile(await loadVault(config), config, [selfApproval]);
    expect(plan.publications[0]?.markdown).toContain("[self](/knowledge/source)");
    expect(plan.diagnostics).toEqual([]);
  });

  it("blocks collisions between working slugs and aliases", async () => {
    // Given two pages claiming the same public route through a slug and an alias.
    await writeFile(
      join(root, "one.md"),
      "---\nid: prv_one\npublic:\n  id: pub_one\n  status: review\n  mode: mirror\n  kind: page\n  slug: /one\n  aliases: [/shared]\n  page:\n    layout: generic\n  title: One\n---\none\n",
    );
    await writeFile(
      join(root, "two.md"),
      "---\nid: prv_two\npublic:\n  id: pub_two\n  status: review\n  mode: mirror\n  kind: page\n  slug: /shared\n  page:\n    layout: generic\n  title: Two\n---\ntwo\n",
    );

    // When compiled, then neither ambiguous route owner is publishable.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_ROUTE_COLLISION" }),
    );
  });

  it("blocks a working route reserved by an approved alias", async () => {
    // Given an approved alias and a different working page claiming it as a slug.
    const target = approved();
    const reserved: ApprovedRevision = {
      ...target,
      metadata: { ...target.metadata, aliases: ["/reserved"] },
    };
    await writeFile(
      join(root, "reserved.md"),
      "---\nid: prv_reserved\npublic:\n  id: pub_reserved\n  status: review\n  mode: mirror\n  kind: page\n  slug: /reserved\n  page:\n    layout: generic\n  title: Reserved\n---\nbody\n",
    );

    // When compiled, then the approved namespace reservation blocks the page.
    const plan = await compile(await loadVault(config), config, [reserved]);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_PATH_RESERVED" }),
    );
  });
});
