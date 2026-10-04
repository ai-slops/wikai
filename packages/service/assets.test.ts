import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { pdfBytes, zipBytes } from "../assets/inspection-fixture.ts";
import { hash } from "../fs/index.ts";
import { Publisher } from "./index.ts";
import { createServiceFixture, knowledgeSource } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;
beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  await mkdir(join(vault, "assets"));
  await mkdir(join(vault, "public-assets"));
  publisher = await Publisher.open(fixture.configPath);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("inspects an unreviewed attachment and references even when publication compilation is blocked", async () => {
  const bytes = await pdfBytes();
  await writeFile(join(vault, "public-assets/guide.pdf"), bytes);
  await writeFile(
    join(vault, "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      body: "[Download](public-assets/guide.pdf)\n\n[[private missing link]]",
    }),
  );
  const before = await readdir(root, { recursive: true });

  const report = await publisher.inspectAsset("public-assets/guide.pdf");

  expect(report).toMatchObject({
    sourcePath: "public-assets/guide.pdf",
    originalName: "guide.pdf",
    sha256: hash(bytes),
    bytes: bytes.length,
    detectedMime: "application/pdf",
    prospectivePublicPath: `/assets/${hash(bytes).slice(7)}.pdf`,
    underPublicAssets: true,
    hashReviewed: false,
    reviewBlockers: ["ASSET_REVIEW_REQUIRED"],
    inspection: { ok: true },
    referencesComplete: true,
    referringCandidateDocuments: [{ publicId: "pub_note", sourcePath: "note.md" }],
  });
  expect(await readdir(root, { recursive: true })).toEqual(before);
  expect(await readFile(join(vault, "public-assets/guide.pdf"))).toEqual(bytes);
  expect(publisher.config.assets.reviewedHashes).toEqual([]);
  expect((await publisher.plan()).publications).toEqual([]);
  expect(report).not.toHaveProperty("data");
});

it("collects inline, reference and wiki-embed uses but excludes private notes, code and comments", async () => {
  await writeFile(join(vault, "public-assets/data.zip"), zipBytes([{ name: "inside.txt" }]));
  const bodies = [
    "[Download](public-assets/data.zip)",
    "[Download][a]\n\n[a]: public-assets/data.zip#fragment",
    "![Archive][a]\n\n[a]: public-assets/data.zip",
    "![[public-assets/data.zip|Archive]]",
    "![Inline](public-assets/data.zip)",
  ];
  for (const [index, body] of bodies.entries()) {
    await writeFile(
      join(vault, `${index}.md`),
      knowledgeSource({
        privateId: `prv_${index}`,
        publicId: `pub_${index}`,
        title: `Note ${index}`,
        body,
      }),
    );
  }
  await writeFile(join(vault, "private.md"), "[Private](public-assets/data.zip)");
  await writeFile(
    join(vault, "literal.md"),
    knowledgeSource({
      privateId: "prv_literal",
      publicId: "pub_literal",
      title: "Literal",
      body: "```md\n![[public-assets/data.zip]]\n```\n\n`[Code](public-assets/data.zip)`\n\n<!-- ![[public-assets/data.zip]] -->",
    }),
  );
  const report = await publisher.inspectAsset("public-assets/data.zip");
  expect(report.referencesComplete).toBe(true);
  expect(report.referringCandidateDocuments.map((document) => document.publicId).sort()).toEqual([
    "pub_0",
    "pub_1",
    "pub_2",
    "pub_3",
    "pub_4",
  ]);
});

it("marks skipped malformed documents as an incomplete reference inventory", async () => {
  await writeFile(join(vault, "public-assets/data.zip"), zipBytes([]));
  await writeFile(join(vault, "broken.md"), "---\npublic: [broken\n---\nPrivate body.");
  const report = await publisher.inspectAsset("public-assets/data.zip");
  expect(report.referencesComplete).toBe(false);
  expect(report.inspection.ok).toBe(true);
});

it("does not claim a complete reference inventory for an unclosed wiki embed", async () => {
  await writeFile(join(vault, "public-assets/data.zip"), zipBytes([]));
  await writeFile(
    join(vault, "broken-link.md"),
    knowledgeSource({
      privateId: "prv_broken",
      publicId: "pub_broken",
      title: "Broken",
      body: "![[public-assets/data.zip",
    }),
  );
  const report = await publisher.inspectAsset("public-assets/data.zip");
  expect(report.referencesComplete).toBe(false);
  expect(report.inspection.ok).toBe(true);
});

it("separates hash-review blockers from the full publication policy", async () => {
  const bytes = Buffer.from("<html>Not a PDF</html>");
  await writeFile(join(vault, "public-assets/fake.pdf"), bytes);
  await writeFile(
    join(vault, "fake.md"),
    knowledgeSource({
      privateId: "prv_fake",
      publicId: "pub_fake",
      title: "Fake",
      slug: "/knowledge/fake",
      body: "[Download](public-assets/fake.pdf)",
    }),
  );
  publisher.config.assets.reviewedHashes.push(hash(bytes));
  const report = await publisher.inspectAsset("public-assets/fake.pdf");
  expect(report).toMatchObject({
    hashReviewed: true,
    reviewBlockers: [],
    inspection: { ok: false },
  });
  expect(report).not.toHaveProperty("publicationBlockers");
  expect((await publisher.plan()).diagnostics).toContainEqual(
    expect.objectContaining({ code: "ASSET_TYPE_FORBIDDEN" }),
  );
});

it("does not treat a reviewed hash outside public-assets as publishable", async () => {
  const bytes = zipBytes([]);
  await writeFile(join(vault, "assets/data.zip"), bytes);
  publisher.config.assets.reviewedHashes.push(hash(bytes));
  const report = await publisher.inspectAsset("assets/data.zip");
  expect(report).toMatchObject({
    hashReviewed: true,
    underPublicAssets: false,
    reviewBlockers: ["ASSET_REVIEW_REQUIRED"],
  });
});

it("requires another explicit hash review after attachment bytes change", async () => {
  const bytes = zipBytes([]);
  await writeFile(join(vault, "public-assets/data.zip"), bytes);
  publisher.config.assets.reviewedHashes.push(hash(bytes));
  expect((await publisher.inspectAsset("public-assets/data.zip")).hashReviewed).toBe(true);
  await writeFile(join(vault, "public-assets/data.zip"), zipBytes([{ name: "new.txt" }]));
  expect((await publisher.inspectAsset("public-assets/data.zip")).hashReviewed).toBe(false);
});

it("rejects traversal, symlinks, non-files and oversized input before inspection", async () => {
  await writeFile(join(root, "outside.pdf"), await pdfBytes());
  await symlink(join(root, "outside.pdf"), join(vault, "public-assets/link.pdf"));
  await mkdir(join(vault, "public-assets/directory.pdf"));
  await expect(publisher.inspectAsset("../outside.pdf")).rejects.toMatchObject({
    code: "ASSET_PATH_TRAVERSAL",
  });
  await expect(publisher.inspectAsset("public-assets/link.pdf")).rejects.toMatchObject({
    code: "ASSET_SYMLINK",
  });
  await expect(publisher.inspectAsset("public-assets/directory.pdf")).rejects.toMatchObject({
    code: "ASSET_NOT_FILE",
  });
  publisher.config.assets.maxFileBytes = 4;
  await writeFile(join(vault, "public-assets/large.pdf"), Buffer.alloc(5));
  await expect(publisher.inspectAsset("public-assets/large.pdf")).rejects.toMatchObject({
    code: "ASSET_TOO_LARGE",
  });
});
