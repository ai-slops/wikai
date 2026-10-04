import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { hash, withLock } from "../fs/index.ts";
import { Publisher } from "./index.ts";
import { splitSource } from "./source.ts";
import { createServiceFixture } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;
let publicId: string;
const original =
  "---\nid: prv_source\n---\nPRIVATE BEFORE\n\n## Share\nOriginal public body.\n\n## Private\nPRIVATE AFTER\n";

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  publisher = await Publisher.open(fixture.configPath);
  await writeFile(join(vault, "source.md"), original);
  ({ publicId } = await publisher.extract({
    path: "source.md",
    to: "public-views/excerpt.md",
    kind: "log",
    heading: "Share",
  }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("previews only the selected source while leaving the authored projection unchanged", async () => {
  const projection = await readFile(join(vault, "public-views/excerpt.md"));
  await writeFile(
    join(vault, "source.md"),
    original.replace("Original public body.", "New source wording."),
  );
  const plan = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  expect(plan).toMatchObject({ canApply: true, sourceBody: "## Share\nNew source wording." });
  expect(plan.projectionBody).toContain("Original public body.");
  expect(plan.sourceBody).not.toContain("PRIVATE");
  expect(await readFile(join(vault, "public-views/excerpt.md"))).toEqual(projection);
  expect((await publisher.sourceUpdate(publicId, { sourceId: "prv_source" })).expectedHash).toBe(
    plan.expectedHash,
  );
});

it("applies an explicitly merged body without replacing the approved revision", async () => {
  const working = (await publisher.detail(publicId)).working;
  if (working === null) throw new TypeError("Missing working publication");
  const approved = await publisher.approve(publicId, working.exposureHash);
  await writeFile(
    join(vault, "source.md"),
    original.replace("Original public body.", "New source wording."),
  );
  const plan = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  await publisher.applySourceUpdate(publicId, {
    sourceId: "prv_source",
    expectedHash: plan.expectedHash,
    body: "# Manually merged\n\nChosen wording.\n",
  });
  const changed = splitSource(await readFile(join(vault, "public-views/excerpt.md"), "utf8"));
  expect(changed.body).toBe("# Manually merged\n\nChosen wording.\n");
  expect((await publisher.detail(publicId)).approved).toEqual(approved);
  expect(changed.frontmatter).toContain(hash("## Share\nNew source wording."));
});

it.each(["source", "projection"])("rejects a stale plan after the %s changes", async (target) => {
  const plan = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  const path = join(vault, target === "source" ? "source.md" : "public-views/excerpt.md");
  const latest = `${await readFile(path, "utf8")}\nConcurrent edit.\n`;
  await writeFile(path, latest);
  await expect(
    publisher.applySourceUpdate(publicId, {
      sourceId: "prv_source",
      expectedHash: plan.expectedHash,
      body: "Do not overwrite",
    }),
  ).rejects.toMatchObject({ code: "STALE_SOURCE_UPDATE" });
  expect(await readFile(path, "utf8")).toBe(latest);
});

it("requires a new selector for a missing heading before any merge can be saved", async () => {
  await writeFile(join(vault, "source.md"), original.replace("## Share", "## Renamed"));
  const blocked = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  expect(blocked).toMatchObject({ canApply: false, sourceBody: null });
  await expect(
    publisher.applySourceUpdate(publicId, {
      sourceId: "prv_source",
      expectedHash: blocked.expectedHash,
      body: "Not selected",
    }),
  ).rejects.toMatchObject({ code: "SOURCE_UPDATE_BLOCKED" });
  const plan = await publisher.sourceUpdate(publicId, {
    sourceId: "prv_source",
    heading: "Renamed",
  });
  expect(plan.sourceBody).toBe("## Renamed\nOriginal public body.");
});

it("does not reuse old line coordinates when a selected line snapshot changed", async () => {
  const extracted = await publisher.extract({
    path: "source.md",
    to: "public-views/lines.md",
    kind: "log",
    lines: "4:4",
  });
  await writeFile(
    join(vault, "source.md"),
    original.replace("Original public body.", "Updated line."),
  );
  const blocked = await publisher.sourceUpdate(extracted.publicId, { sourceId: "prv_source" });
  expect(blocked.canApply).toBe(false);
  const selected = await publisher.sourceUpdate(extracted.publicId, {
    sourceId: "prv_source",
    lines: "4:4",
  });
  expect(selected.sourceBody).toBe("Updated line.");
});

it("disambiguates two references to the same source by index", async () => {
  const path = join(vault, "public-views/excerpt.md");
  const parts = splitSource(await readFile(path, "utf8"));
  const frontmatter = parseDocument(parts.frontmatter);
  frontmatter.setIn(
    ["public", "sources"],
    [
      { id: "prv_source", anchor: "heading:Share", capturedHash: hash(original) },
      { id: "prv_source", anchor: "heading:Private", capturedHash: hash(original) },
    ],
  );
  await writeFile(path, `---\n${frontmatter.toString()}---\n${parts.body}`);
  await expect(publisher.sourceUpdate(publicId, { sourceId: "prv_source" })).rejects.toMatchObject({
    code: "SOURCE_REFERENCE_AMBIGUOUS",
  });
  const plan = await publisher.sourceUpdate(publicId, {
    sourceId: "prv_source",
    referenceIndex: 0,
  });
  expect(plan.sourceBody).toBe("## Share\nOriginal public body.");
  await expect(
    publisher.sourceUpdate(publicId, { sourceId: "prv_wrong", referenceIndex: 0 }),
  ).rejects.toMatchObject({ code: "SOURCE_REFERENCE_NOT_FOUND" });
});

it("preserves comments, quote style and CRLF when updating the selected reference", async () => {
  const path = join(vault, "public-views/excerpt.md");
  const raw = (await readFile(path, "utf8"))
    .replace("title:", "# Keep review comment\ntitle:")
    .replaceAll("\n", "\r\n");
  await writeFile(path, raw);
  const plan = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  await publisher.applySourceUpdate(publicId, {
    sourceId: "prv_source",
    expectedHash: plan.expectedHash,
    body: "    preserved indent",
  });
  const updated = await readFile(path, "utf8");
  expect(updated).toContain("# Keep review comment\r\n");
  expect(updated.endsWith("    preserved indent\r\n")).toBe(true);
  expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
});

it("uses the publication lock and rejects an untracked private source", async () => {
  const plan = await publisher.sourceUpdate(publicId, { sourceId: "prv_source" });
  await withLock(publisher.config.publisher.stateDir, async () => {
    await expect(
      publisher.applySourceUpdate(publicId, {
        sourceId: "prv_source",
        expectedHash: plan.expectedHash,
        body: "Locked",
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_LOCKED" });
  });
  await writeFile(join(vault, "untracked.md"), "---\nid: prv_untracked\n---\nPrivate");
  await expect(
    publisher.sourceUpdate(publicId, { sourceId: "prv_untracked" }),
  ).rejects.toMatchObject({ code: "SOURCE_REFERENCE_NOT_FOUND" });
});
