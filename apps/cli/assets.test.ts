import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PDFName, PDFString } from "pdf-lib";
import { afterEach, beforeEach, expect, it } from "vitest";
import { pdfBytes } from "../../packages/assets/inspection-fixture.ts";
import { pdfWithMetadata, setXmp, xmpPacket } from "../../packages/assets/pdf-metadata-fixture.ts";
import { hash } from "../../packages/fs/index.ts";
import { createServiceFixture, knowledgeSource } from "../../packages/service/test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;
let bytes: Buffer;
beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
  await mkdir(join(vault, "public-assets"));
  bytes = await pdfBytes();
  await writeFile(join(vault, "public-assets/review.pdf"), bytes);
  await writeFile(
    join(vault, "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      slug: "/knowledge/note",
      body: "[File](public-assets/review.pdf)",
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, ...args],
    {
      encoding: "utf8",
      timeout: 20_000,
    },
  );
}

it("exposes read-only metadata JSON without approving the attachment or changing files", async () => {
  const before = await readdir(root, { recursive: true });
  const help = cli("assets", "inspect", "--help");
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("vault-relative");
  const result = cli("assets", "inspect", "public-assets/review.pdf", "--json");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    sha256: hash(bytes),
    hashReviewed: false,
    reviewBlockers: ["ASSET_REVIEW_REQUIRED"],
    inspection: {
      ok: true,
      metadata: { kind: "pdf", info: { author: "PRIVATE_SENTINEL_PDF_AUTHOR" } },
    },
    referringCandidateDocuments: [{ publicId: "pub_note", sourcePath: "note.md" }],
  });
  expect(await readdir(root, { recursive: true })).toEqual(before);
  expect(await readFile(join(vault, "public-assets/review.pdf"))).toEqual(bytes);
  const validation = cli("validate", "--json");
  expect(validation.status).toBe(1);
  expect(JSON.parse(validation.stdout)).toContainEqual(
    expect.objectContaining({ code: "ASSET_REVIEW_REQUIRED" }),
  );
});

it("returns a failure report for malformed metadata without logging raw parser excerpts", async () => {
  await writeFile(join(vault, "public-assets/broken.pdf"), "PRIVATE_SENTINEL_UNPARSEABLE");
  const result = cli("assets", "inspect", "public-assets/broken.pdf", "--json");
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ inspection: { ok: false } });
  expect(result.stderr).not.toContain("PRIVATE_SENTINEL_UNPARSEABLE");
  expect(result.stdout).not.toContain("PRIVATE_SENTINEL_UNPARSEABLE");
});

it("refuses a path outside the vault instead of reading it", () => {
  const result = cli("assets", "inspect", "../outside.pdf", "--json");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ASSET_PATH_TRAVERSAL");
});

it("reports private XMP and custom Info through the CLI without editing bytes or granting review", async () => {
  const extended = await pdfWithMetadata((pdf, info) => {
    setXmp(pdf, Buffer.from(xmpPacket), true);
    info.set(PDFName.of("ReviewSecret"), PDFString.of("PRIVATE_SENTINEL_CUSTOM"));
  });
  await writeFile(join(vault, "public-assets/review.pdf"), extended);
  const configuration = await readFile(configPath);
  const before = await readdir(root, { recursive: true });
  const result = cli("assets", "inspect", "public-assets/review.pdf", "--json");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    sha256: hash(extended),
    hashReviewed: false,
    inspection: {
      ok: true,
      metadata: {
        xmp: { text: xmpPacket, compression: "flate" },
        additionalInfo: [{ key: "ReviewSecret", kind: "string", value: "PRIVATE_SENTINEL_CUSTOM" }],
        additionalInfoComplete: true,
      },
    },
  });
  expect(await readFile(join(vault, "public-assets/review.pdf"))).toEqual(extended);
  expect(await readFile(configPath)).toEqual(configuration);
  expect(await readdir(root, { recursive: true })).toEqual(before);
  expect(cli("validate", "--json").status).toBe(1);
});

it("rejects unsupported XMP without dumping its private packet in an error report", async () => {
  const invalid = await pdfWithMetadata((pdf, info) => {
    info.set(PDFName.of("PartialSecret"), PDFString.of("PRIVATE_SENTINEL_UNSUPPORTED_XMP"));
    const stream = setXmp(pdf, Buffer.from("<x>PRIVATE_SENTINEL_UNSUPPORTED_XMP</x>"));
    stream.dict.set(PDFName.of("Filter"), PDFName.of("ASCII85Decode"));
  });
  await writeFile(join(vault, "public-assets/review.pdf"), invalid);
  const result = cli("assets", "inspect", "public-assets/review.pdf", "--json");
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    inspection: { ok: false, code: "ASSET_PDF_METADATA_UNSUPPORTED" },
  });
  expect(`${result.stdout}${result.stderr}`).not.toContain("PRIVATE_SENTINEL_UNSUPPORTED_XMP");
});
