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
  root = await mkdtemp(join(tmpdir(), "wikai-assets-hardening-"));
  await mkdir(join(root, "assets"));
  await mkdir(join(root, "public-assets"));
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

const note = (body: string): string =>
  `---\nid: prv_note\npublic:\n  id: pub_note\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/note\n  title: Note\n  summary: Asset validation\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\n${body}\n`;

describe("asset and vault hardening", () => {
  it("rejects a raster whose extension disagrees with detected MIME", async () => {
    // Given PNG bytes named with a JPEG extension.
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .png()
      .toFile(join(root, "assets", "pixel.jpg"));
    await writeFile(join(root, "note.md"), note("![pixel](assets/pixel.jpg)"));

    // When compiled, then the mismatch is blocked before publication.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASSET_EXTENSION_MISMATCH" }),
    );
  });

  it("requires explicit source-hash review for GIF images", async () => {
    // Given an unreviewed GIF under the high-risk asset root.
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .gif()
      .toBuffer();
    await writeFile(join(root, "public-assets", "pixel.gif"), bytes);
    await writeFile(join(root, "note.md"), note("![pixel](public-assets/pixel.gif)"));

    // When compiled, then automatic raster acceptance is denied.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASSET_REVIEW_REQUIRED" }),
    );
  });

  it("sanitizes a GIF after its exact source hash is reviewed", async () => {
    // Given a GIF with an explicitly reviewed source hash.
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } })
      .gif()
      .toBuffer();
    await writeFile(join(root, "public-assets", "pixel.gif"), bytes);
    await writeFile(join(root, "note.md"), note("![pixel](public-assets/pixel.gif)"));
    const reviewed: PublisherConfig = {
      ...config,
      assets: { ...config.assets, reviewedHashes: [hash(bytes)] },
    };

    // When compiled, then sanitized GIF bytes are content-addressed.
    const plan = await compile(await loadVault(reviewed), reviewed);
    expect(plan.publications[0]?.assets[0]).toMatchObject({ mime: "image/gif", reviewed: true });
  });

  it("rejects a hash-reviewed extension outside the attachment allowlist", async () => {
    // Given a reviewed arbitrary binary extension.
    const bytes = Buffer.from("reviewed but unsupported");
    await writeFile(join(root, "public-assets", "payload.bin"), bytes);
    await writeFile(join(root, "note.md"), note("[payload](public-assets/payload.bin)"));
    const reviewed: PublisherConfig = {
      ...config,
      assets: { ...config.assets, reviewedHashes: [hash(bytes)] },
    };

    // When compiled, then allowlisting wins over the reviewed hash.
    const plan = await compile(await loadVault(reviewed), reviewed);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASSET_TYPE_FORBIDDEN" }),
    );
  });

  it("blocks private IDs inside reviewed attachment bytes", async () => {
    // Given a reviewed text attachment containing a private identifier.
    const bytes = Buffer.from("reference prv_hidden_source");
    await writeFile(join(root, "public-assets", "notes.txt"), bytes);
    await writeFile(join(root, "note.md"), note("[notes](public-assets/notes.txt)"));
    const reviewed: PublisherConfig = {
      ...config,
      assets: { ...config.assets, reviewedHashes: [hash(bytes)] },
    };

    // When compiled, then private-ID scanning blocks the publication.
    const plan = await compile(await loadVault(reviewed), reviewed);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_SECRET_DETECTED" }),
    );
  });

  it("diagnoses duplicate private IDs even when no links reference them", async () => {
    // Given two otherwise private documents with the same private ID.
    await writeFile(join(root, "one.md"), "---\nid: prv_duplicate\n---\none\n");
    await writeFile(join(root, "two.md"), "---\nid: prv_duplicate\n---\ntwo\n");

    // When loading the vault, then both duplicate owners are globally diagnosed.
    const vault = await loadVault(config);
    expect(vault.diagnostics.filter(({ code }) => code === "PRIVATE_ID_COLLISION")).toHaveLength(2);
  });
});
