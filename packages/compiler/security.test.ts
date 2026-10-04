import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { ConfigSchema, type PublisherConfig } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

let root: string;
let config: PublisherConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-compiler-security-"));
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

describe("compiler security boundary", () => {
  it("sanitizes raster assets and includes their bytes in the exposure hash", async () => {
    // Given an image whose pixels later change.
    const imagePath = join(root, "assets", "pixel.png");
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 })
      .png()
      .toFile(imagePath);
    await writeFile(
      join(root, "image.md"),
      "---\nid: prv_image\npublic:\n  id: pub_image\n  status: review\n  mode: mirror\n  kind: work\n  slug: /work/image\n  title: Image\n  summary: Image work\n  work:\n    role: Engineer\n    projectStatus: active\n---\n![pixel](assets/pixel.png)\n",
    );
    const first = await compile(await loadVault(config), config);

    // When the same source image path contains different pixels.
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } })
      .png()
      .toFile(imagePath);
    const second = await compile(await loadVault(config), config);

    // Then sanitized content-addressed output and the exposure hash change.
    expect(first.publications[0]?.assets[0]).toMatchObject({ mime: "image/png", reviewed: true });
    expect(first.publications[0]?.assets[0]?.sourcePath).toBeUndefined();
    expect(first.publications[0]?.exposureHash).not.toBe(second.publications[0]?.exposureHash);
    expect(
      Buffer.from(first.publications[0]?.assets[0]?.data ?? "", "base64").includes(
        Buffer.from("exif", "utf8"),
      ),
    ).toBe(false);
  });

  it.each([
    ["raw HTML", "<script>alert(1)</script>", "MARKDOWN_HTML_FORBIDDEN"],
    ["transclusion", "![[private]]", "MARKDOWN_TRANSCLUSION_FORBIDDEN"],
    ["remote image", "![x](https://example.invalid/x.png)", "ASSET_REMOTE_FORBIDDEN"],
    ["MDX", "<Widget secret={value} />", "MARKDOWN_HTML_FORBIDDEN"],
    ["MDX expression", "{privateValue}", "MARKDOWN_MDX_FORBIDDEN"],
    ["unsafe link scheme", "[x](javascript:alert(1))", "MARKDOWN_LINK_SCHEME_FORBIDDEN"],
    ["asset traversal", "![x](../outside.png)", "ASSET_PATH_TRAVERSAL"],
    ["public sentinel", "PRIVATE_SENTINEL_EXPOSED", "PUBLIC_SECRET_DETECTED"],
  ])("blocks %s", async (_case, body, code) => {
    // Given adversarial public Markdown.
    await writeFile(
      join(root, "bad.md"),
      `---\nid: prv_bad\npublic:\n  id: pub_bad\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/bad\n  title: Bad\n  summary: Security case\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n${body}\n`,
    );

    // When compiled, then it is excluded with a stable diagnostic code.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code, publicId: "pub_bad", severity: "error" }),
    );
  });

  it("does not interpret link syntax inside code", async () => {
    // Given code containing links and transclusion syntax.
    await writeFile(
      join(root, "code.md"),
      "---\nid: prv_code\npublic:\n  id: pub_code\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/code\n  title: Code\n  summary: Code syntax\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n`[[private]]`\n\n```md\n![[private]]\n[private](private.md)\n```\n",
    );

    // When compiled, then code is preserved without target resolution.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toHaveLength(1);
    expect(plan.publications[0]?.outgoingLinks).toEqual([]);
  });

  it("allows a projection at any included vault path", async () => {
    // Given projection frontmatter outside the conventional public-views directory.
    await writeFile(
      join(root, "projection.md"),
      "---\nid: prv_projection_anywhere\npublic:\n  id: pub_projection\n  status: review\n  mode: projection\n  kind: page\n  slug: /projection\n  title: Projection\n  page:\n    layout: generic\n---\nbody\n",
    );

    // When compiled, then mode rather than directory determines projection semantics.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications.map(({ publicId }) => publicId)).toContain("pub_projection");
  });

  it("requires explicit content-hash review for non-image attachments", async () => {
    // Given an attachment under public-assets without a reviewed hash.
    await mkdir(join(root, "public-assets"));
    await writeFile(join(root, "public-assets", "manual.txt"), "safe attachment");
    await writeFile(
      join(root, "attachment.md"),
      "---\nid: prv_attachment\npublic:\n  id: pub_attachment\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/attachment\n  title: Attachment\n  summary: Reviewed attachment\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n[manual](public-assets/manual.txt)\n",
    );

    // When compiled, then the attachment is blocked pending review.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASSET_REVIEW_REQUIRED" }),
    );
  });

  it("materializes a hash-reviewed non-image attachment", async () => {
    // Given an attachment whose exact bytes are reviewed.
    const content = "safe attachment";
    await mkdir(join(root, "public-assets"));
    await writeFile(join(root, "public-assets", "manual.txt"), content);
    await writeFile(
      join(root, "attachment.md"),
      "---\nid: prv_attachment\npublic:\n  id: pub_attachment\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/attachment\n  title: Attachment\n  summary: Reviewed attachment\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n[manual](public-assets/manual.txt)\n",
    );
    const reviewedConfig: PublisherConfig = {
      ...config,
      assets: { ...config.assets, reviewedHashes: [hash(content)] },
    };

    // When compiled, then content-addressed bytes are embedded for release.
    const plan = await compile(await loadVault(reviewedConfig), reviewedConfig);
    expect(plan.publications[0]?.assets[0]).toMatchObject({
      hash: hash(content),
      mime: "text/plain",
      reviewed: true,
    });
    expect(plan.publications[0]?.markdown).toMatch(/\/assets\/[a-f0-9]{64}\.txt/u);
  });

  it.each([
    "relative",
    "/trailing/",
    "/empty//segment",
    "/../secret",
    "/has?query",
    "/has#fragment",
    "/encoded%2Fslash",
    "/back\\slash",
  ])("rejects unsafe explicit slug %s", async (slug) => {
    // Given a publication with a non-canonical or unsafe route path.
    await writeFile(
      join(root, "slug.md"),
      `---\nid: prv_slug\npublic:\n  id: pub_slug\n  status: review\n  mode: mirror\n  kind: page\n  page:\n    layout: generic\n  title: Slug\n  slug: ${JSON.stringify(slug)}\n---\nbody\n`,
    );

    // When compiled, then the invalid route is blocked.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_SLUG_INVALID", publicId: "pub_slug" }),
    );
  });
});
