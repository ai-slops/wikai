import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { hash } from "../fs/index.ts";
import { SourceSchema } from "../model/index.ts";
import { buildReleaseStaging } from "../release/index.ts";
import { PublisherState } from "../state/index.ts";
import { loadVault } from "../vault/index.ts";
import { captureApproval } from "./approval.ts";
import { Publisher } from "./index.ts";
import { splitSource } from "./source.ts";
import { createServiceFixture } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;
let publicId: string;
const original = "---\nid: prv_source\n---\n## Share\nOriginal.\n\n## Other\nUnrelated.\n";

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

async function approve() {
  const detail = await publisher.detail(publicId);
  if (detail.working === null) throw new TypeError("Missing working publication");
  return publisher.approve(publicId, detail.working.exposureHash);
}

it("captures the current heading baseline on explicit approval without syncing the copied body", async () => {
  await writeFile(join(vault, "source.md"), original.replace("Original.", "Changed."));

  const revision = await approve();

  expect(revision.markdown).toContain("Original.");
  expect(revision.markdown).not.toContain("Changed.");
  const state = await PublisherState.open(publisher.config.publisher.stateDir);
  expect(await state.approvedSources(publicId)).toMatchObject([
    {
      capturedHash: hash("## Share\nChanged."),
      selection: { version: 1, kind: "heading", value: "Share" },
    },
  ]);
  expect((await publisher.detail(publicId)).sourceDrift).toBe(false);
});

it("keeps a missing heading baseline so approval does not hide unresolved drift", async () => {
  await writeFile(join(vault, "source.md"), original.replace("## Share", "## Renamed"));
  await approve();
  expect((await publisher.detail(publicId)).sourceDrift).toBe(true);
  const state = await PublisherState.open(publisher.config.publisher.stateDir);
  expect(await state.approvedSources(publicId)).toMatchObject([
    { capturedHash: hash("## Share\nOriginal.") },
  ]);
});

it("keeps a missing line-content baseline rather than adopting the new contents at old coordinates", async () => {
  const extracted = await publisher.extract({
    path: "source.md",
    to: "public-views/lines.md",
    kind: "log",
    lines: "2:2",
  });
  publicId = extracted.publicId;
  await publisher.updateMetadata(publicId, { slug: "/log/lines" }, extracted.sourceHash);
  await writeFile(join(vault, "source.md"), original.replace("Original.", "Changed."));
  await approve();
  expect((await publisher.detail(publicId)).sourceDrift).toBe(true);
  const state = await PublisherState.open(publisher.config.publisher.stateDir);
  expect(await state.approvedSources(publicId)).toMatchObject([
    { capturedHash: hash("Original."), selection: { version: 1, kind: "lines", lineCount: 1 } },
  ]);
});

it("still rejects whole-file concurrency changes even outside the selected heading", async () => {
  const detail = await publisher.detail(publicId);
  if (detail.working === null) throw new TypeError("Missing working publication");
  const snapshot = await loadVault(publisher.config);
  await writeFile(join(vault, "source.md"), original.replace("Unrelated.", "Concurrent edit."));
  await expect(captureApproval(publisher.config, detail.working, snapshot)).rejects.toMatchObject({
    code: "CONCURRENT_SOURCE_MODIFICATION",
  });
});

it("restores historical selectors and baselines without exposing them in release staging", async () => {
  const first = await approve();
  const path = join(vault, "public-views/excerpt.md");
  const firstSource = await readFile(path, "utf8");
  const parts = splitSource(firstSource);
  const frontmatter = parseDocument(parts.frontmatter);
  frontmatter.setIn(
    ["public", "sources"],
    [
      {
        id: "prv_source",
        anchor: "heading:Other",
        capturedHash: hash("## Other\nUnrelated."),
        selection: { version: 1, kind: "heading", value: "Other" },
      },
    ],
  );
  await writeFile(path, `---\n${frontmatter.toString()}---\nSecond public revision.\n`);
  const second = await approve();
  await writeFile(path, firstSource);
  await writeFile(join(vault, "source.md"), original.replace("Original.", "Changed."));

  await publisher.restore(publicId, first.revisionHash, second.exposureHash);

  const reopened = await Publisher.open(join(root, "publisher.config.yaml"));
  expect((await reopened.detail(publicId)).sourceDrift).toBe(true);
  const state = await PublisherState.open(publisher.config.publisher.stateDir);
  expect(await state.approvedSources(publicId)).toMatchObject([
    {
      capturedHash: hash("## Share\nOriginal."),
      selection: { version: 1, kind: "heading", value: "Share" },
    },
  ]);
  await writeFile(join(vault, "source.md"), original);
  expect((await reopened.detail(publicId)).sourceDrift).toBe(false);
  await buildReleaseStaging((await state.snapshot()).approved, publisher.config);
  const staging = await readFile(join(root, "release/content-index.json"), "utf8");
  expect(staging).toContain("Original.");
  expect(staging).not.toContain("Second public revision.");
  expect(staging).not.toMatch(/prv_source|capturedHash|selection|heading:Share/u);
});

it.each([
  { version: 2, kind: "heading", value: "Share" },
  { version: 1, kind: "lines", lineCount: 0 },
  { version: 1, kind: "block", value: "" },
  { version: 1, kind: "heading", value: "Share", unknown: true },
])("rejects invalid versioned selection metadata %j", (selection) => {
  expect(
    SourceSchema.safeParse({ id: "prv_source", capturedHash: hash("fragment"), selection }).success,
  ).toBe(false);
});

it("requires a fragment hash for versioned selections but still accepts old hash-less references", () => {
  expect(SourceSchema.safeParse({ id: "prv_source" }).success).toBe(true);
  expect(
    SourceSchema.safeParse({
      id: "prv_source",
      selection: { version: 1, kind: "heading", value: "Share" },
    }).success,
  ).toBe(false);
});
