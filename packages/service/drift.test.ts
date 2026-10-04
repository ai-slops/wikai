import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { hash } from "../fs/index.ts";
import { Publisher } from "./index.ts";
import type { ExtractInput } from "./schema.ts";
import { splitSource } from "./source.ts";
import { createServiceFixture } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;
const original =
  "---\nid: prv_source\ntitle: Private\n---\n# Journal\nPRIVATE BEFORE\n\n## Share\n\nPublic text. ^share\n\n## Personal\nPRIVATE AFTER\n";
const selectors = [{ heading: "Share" }, { block: "share" }, { lines: "6:6" }] as const;

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  publisher = await Publisher.open(fixture.configPath);
  await writeFile(join(vault, "source.md"), original);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function extract(selector: Pick<ExtractInput, "heading" | "block" | "lines">) {
  return publisher.extract({
    path: "source.md",
    to: "public-views/excerpt.md",
    kind: "log",
    ...selector,
  });
}

async function approve(publicId: string) {
  const detail = await publisher.detail(publicId);
  if (detail.working === null) throw new TypeError("Missing working publication");
  return publisher.approve(publicId, detail.working.exposureHash);
}

describe("selection drift before and after approval", () => {
  it.each(selectors)(
    "reports a changed candidate source for %j without overwriting its projection",
    async (selector) => {
      const extracted = await extract(selector);
      const before = await readFile(join(vault, extracted.path), "utf8");
      const exposureHash = (await publisher.detail(extracted.publicId)).working?.exposureHash;
      await writeFile(join(vault, "source.md"), original.replace("Public text.", "Changed text."));

      const detail = await publisher.detail(extracted.publicId);

      expect(detail.sourceDrift).toBe(true);
      expect(detail.approved).toBeNull();
      expect(detail.working?.exposureHash).toBe(exposureHash);
      expect(await readFile(join(vault, extracted.path), "utf8")).toBe(before);
      expect((await publisher.status()).publications).toContainEqual(
        expect.objectContaining({
          publicId: extracted.publicId,
          status: "candidate",
          sourceDrift: true,
        }),
      );
    },
  );

  it.each(selectors)("ignores unrelated source edits for candidate %j", async (selector) => {
    const extracted = await extract(selector);
    await writeFile(join(vault, "source.md"), original.replace("PRIVATE AFTER", "UNRELATED EDIT"));
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
  });

  it.each(selectors)("ignores unrelated source edits after approving %j", async (selector) => {
    const extracted = await extract(selector);
    const revision = await approve(extracted.publicId);
    await writeFile(join(vault, "source.md"), original.replace("PRIVATE AFTER", "UNRELATED EDIT"));

    const detail = await publisher.detail(extracted.publicId);

    expect(detail.sourceDrift).toBe(false);
    expect(detail.approved?.revisionHash).toBe(revision.revisionHash);
    expect((await publisher.status()).publications).toContainEqual(
      expect.objectContaining({
        publicId: extracted.publicId,
        status: "published",
        sourceDrift: false,
      }),
    );
  });

  it.each(selectors)("reports selected-content changes after approving %j", async (selector) => {
    const extracted = await extract(selector);
    const revision = await approve(extracted.publicId);
    await writeFile(join(vault, "source.md"), original.replace("Public text.", "Changed text."));
    const detail = await publisher.detail(extracted.publicId);
    expect(detail.sourceDrift).toBe(true);
    expect(detail.approved).toEqual(revision);
    expect((await publisher.status()).publications).toContainEqual(
      expect.objectContaining({
        publicId: extracted.publicId,
        status: "source-drift",
        sourceDrift: true,
      }),
    );
  });

  it.each(selectors)("ignores CRLF conversion and private metadata for %j", async (selector) => {
    const extracted = await extract(selector);
    await approve(extracted.publicId);
    await writeFile(
      join(vault, "source.md"),
      original.replace("title: Private", "title: Changed").replaceAll("\n", "\r\n"),
    );
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
  });

  it("tracks moved line content by hash rather than its original line numbers", async () => {
    const extracted = await extract({ lines: "6:6" });
    await approve(extracted.publicId);
    await writeFile(
      join(vault, "source.md"),
      original.replace("# Journal", "New unrelated lines.\n\n# Journal"),
    );
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
  });

  it("ignores trailing blank lines excluded by fragment hash normalization", async () => {
    await writeFile(join(vault, "source.md"), "---\nid: prv_source\n---\nPublic text.\n\n");
    const extracted = await extract({ lines: "1:2" });
    await writeFile(join(vault, "source.md"), "---\nid: prv_source\n---\nPublic text.");
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
  });

  it.each([
    { selector: { heading: "Share" }, body: original.replace("## Share", "## Renamed") },
    { selector: { heading: "Share" }, body: `${original}\n## Share\nAnother section.` },
    { selector: { block: "share" }, body: original.replace("^share", "^renamed") },
    { selector: { block: "share" }, body: `${original}\nAnother block. ^share` },
    { selector: { lines: "6:6" }, body: `${original}\nPublic text. ^share` },
  ])(
    "reports unresolved or ambiguous selections before approval: $selector",
    async ({ selector, body }) => {
      const extracted = await extract(selector);
      await writeFile(join(vault, "source.md"), body);
      expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(true);
    },
  );

  it("reports a deleted dependency before approval", async () => {
    const extracted = await extract({ heading: "Share" });
    await rm(join(vault, "source.md"));
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(true);
  });

  it("reports candidate dependency drift even when its working preview is blocked", async () => {
    const extracted = await extract({ heading: "Share" });
    const path = join(vault, extracted.path);
    const parts = splitSource(await readFile(path, "utf8"));
    await writeFile(path, `---\n${parts.frontmatter}\n---\n<script>blocked</script>\n`);
    await writeFile(join(vault, "source.md"), original.replace("Public text.", "Changed text."));

    const detail = await publisher.detail(extracted.publicId);

    expect(detail.working).toBeNull();
    expect(detail.sourceDrift).toBe(true);
    expect((await publisher.status()).publications).toContainEqual(
      expect.objectContaining({
        publicId: extracted.publicId,
        status: "blocked",
        sourceDrift: true,
      }),
    );
  });
});

describe("legacy reference compatibility", () => {
  it("keeps old anchors as whole-file references rather than guessing fragment semantics", async () => {
    const extracted = await extract({ heading: "Share" });
    const path = join(vault, extracted.path);
    const parts = splitSource(await readFile(path, "utf8"));
    const frontmatter = parseDocument(parts.frontmatter);
    frontmatter.setIn(
      ["public", "sources"],
      [{ id: "prv_source", anchor: "heading:Share", capturedHash: hash(original) }],
    );
    await writeFile(path, `---\n${frontmatter.toString()}---\n${parts.body}`);
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
    await approve(extracted.publicId);
    await writeFile(join(vault, "source.md"), original.replace("PRIVATE AFTER", "UNRELATED EDIT"));
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(true);
  });

  it("does not invent a baseline for an existing hash-less candidate reference", async () => {
    const extracted = await extract({ heading: "Share" });
    const path = join(vault, extracted.path);
    const parts = splitSource(await readFile(path, "utf8"));
    const frontmatter = parseDocument(parts.frontmatter);
    frontmatter.setIn(["public", "sources"], [{ id: "prv_source" }]);
    await writeFile(path, `---\n${frontmatter.toString()}---\n${parts.body}`);
    expect((await publisher.detail(extracted.publicId)).sourceDrift).toBe(false);
  });
});
