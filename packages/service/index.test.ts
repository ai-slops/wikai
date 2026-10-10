import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { Publisher } from "./index.ts";
import { createServiceFixture, knowledgeSource } from "./test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Publisher workflows", () => {
  it("preserves body and YAML comments when marking a source as candidate", async () => {
    // Given authored Markdown, when candidate metadata is added, then prose and comments survive.
    const path = join(vault, "note.md");
    const source = `---
# keep this comment
id: prv_note
title: Example
---
# Example

Private body.  
`;
    await writeFile(path, source);
    const publisher = await Publisher.open(configPath);

    await publisher.candidate({
      path: "note.md",
      kind: "knowledge",
      mode: "mirror",
      expectedHash: hash(source),
    });

    const changed = await readFile(path, "utf8");
    expect(changed).toContain("# keep this comment");
    expect(changed.endsWith("# Example\n\nPrivate body.  \n")).toBe(true);
  });

  it("rejects candidate mutation when the expected source hash is stale", async () => {
    // Given a concurrent source edit, when candidate writes with an old hash, then preserve the edit.
    const path = join(vault, "note.md");
    await writeFile(path, "# Newer\n");
    const publisher = await Publisher.open(configPath);

    await expect(
      publisher.candidate({
        path: "note.md",
        kind: "knowledge",
        mode: "mirror",
        expectedHash: hash("# Older\n"),
      }),
    ).rejects.toMatchObject({ code: "CONCURRENT_SOURCE_MODIFICATION" });
    expect(await readFile(path, "utf8")).toBe("# Newer\n");
  });

  it("extracts only the selected heading into a projection", async () => {
    // Given private text around a heading, when extracted, then surrounding private text is excluded.
    const source = `---
id: prv_note
title: Source
---
PRIVATE BEFORE

## Share Me

Public paragraph.

## Private Again

PRIVATE AFTER
`;
    await writeFile(join(vault, "note.md"), source);
    const publisher = await Publisher.open(configPath);

    await publisher.extract({
      path: "note.md",
      to: "public-views/excerpt.md",
      kind: "knowledge",
      heading: "Share Me",
      expectedHash: hash(source),
    });

    const projection = await readFile(join(vault, "public-views", "excerpt.md"), "utf8");
    expect(projection).toContain("Public paragraph.");
    expect(projection).not.toContain("PRIVATE BEFORE");
    expect(projection).not.toContain("PRIVATE AFTER");
  });

  it("keeps an approved revision active after source edits", async () => {
    // Given an approved publication, when its source changes, then approval is immutable and drift is shown.
    const path = join(vault, "published.md");
    const source = knowledgeSource({
      privateId: "prv_published",
      publicId: "pub_published",
      title: "Published",
      slug: "/knowledge/published",
      body: "# Published\n\nOriginal public body.\n",
    });
    await writeFile(path, source);
    const publisher = await Publisher.open(configPath);
    const initial = await publisher.detail("pub_published");
    const exposureHash = initial.working?.exposureHash;
    expect(exposureHash).toBeTypeOf("string");
    if (exposureHash === undefined) throw new TypeError("working publication missing");
    const approved = await publisher.approve("pub_published", exposureHash);

    await writeFile(path, source.replace("Original public body.", "Changed public body."));
    const detail = await publisher.detail("pub_published");

    expect(detail.approved?.revisionHash).toBe(approved.revisionHash);
    expect(detail.sourceDrift).toBe(true);
    expect(detail.working?.exposureHash).not.toBe(approved.exposureHash);
  });

  it("retains the private source path for an orphaned approval", async () => {
    // Given an approved publication, when its source is deleted, then orphan status retains its path.
    const path = join(vault, "orphan.md");
    await writeFile(
      path,
      knowledgeSource({
        privateId: "prv_orphan",
        publicId: "pub_orphan",
        title: "Orphan",
        slug: "/knowledge/orphan",
        body: "# Orphan\n",
      }),
    );
    const publisher = await Publisher.open(configPath);
    const detail = await publisher.detail("pub_orphan");
    const exposureHash = detail.working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");
    await publisher.approve("pub_orphan", exposureHash);

    await rm(path);
    const row = (await publisher.status()).publications.find(
      (publication) => publication.publicId === "pub_orphan",
    );

    expect(row).toMatchObject({ status: "orphaned", sourcePath: "orphan.md", sourceDrift: true });
  });

  it("writes published authoring status when approval succeeds", async () => {
    // Given reviewed source bytes, when approved, then the CST status changes to published.
    const path = join(vault, "approval.md");
    await writeFile(
      path,
      knowledgeSource({
        privateId: "prv_approval",
        publicId: "pub_approval",
        title: "Approval",
        slug: "/knowledge/approval",
        body: "# Approval\n",
        comment: "workflow comment",
      }),
    );
    const publisher = await Publisher.open(configPath);
    const exposureHash = (await publisher.detail("pub_approval")).working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");

    await publisher.approve("pub_approval", exposureHash);

    const changed = await readFile(path, "utf8");
    expect(changed).toContain("status: published");
    expect(changed).toContain("# workflow comment");
    expect(changed.endsWith("# Approval\n")).toBe(true);
  });

  it("requires an explicit slug before approval", async () => {
    // Given compiler fallback slug metadata, when approval is attempted, then explicit review is required.
    await writeFile(
      join(vault, "fallback.md"),
      knowledgeSource({
        privateId: "prv_fallback",
        publicId: "pub_fallback",
        title: "Fallback",
        body: "# Fallback\n",
      }),
    );
    const publisher = await Publisher.open(configPath);
    const exposureHash = (await publisher.detail("pub_fallback")).working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");

    await expect(publisher.approve("pub_fallback", exposureHash)).rejects.toMatchObject({
      code: "PUBLIC_SLUG_REQUIRED",
    });
  });

  it("reports original private-source drift for an extracted projection", async () => {
    // Given an approved extraction, when its private source changes, then projection detail shows drift.
    const sourcePath = join(vault, "source.md");
    const source = `---
id: prv_source
title: Source
---
## Share

Public excerpt.
`;
    await writeFile(sourcePath, source);
    const publisher = await Publisher.open(configPath);
    const extracted = await publisher.extract({
      path: "source.md",
      to: "public-views/share-drift.md",
      kind: "knowledge",
      heading: "Share",
      expectedHash: hash(source),
    });
    await publisher.updateMetadata(
      extracted.publicId,
      {
        slug: "/knowledge/share-drift",
        summary: "Extracted public source",
        contentState: "stable",
      },
      extracted.sourceHash,
    );
    const extractedDetail = await publisher.detail(extracted.publicId);
    expect(extractedDetail.working, JSON.stringify(extractedDetail.diagnostics)).not.toBeNull();
    const exposureHash = extractedDetail.working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");
    await publisher.approve(extracted.publicId, exposureHash);

    await writeFile(sourcePath, source.replace("Public excerpt.", "Changed private source."));
    const detail = await publisher.detail(extracted.publicId);

    expect(detail.sourceDrift).toBe(true);
  });

  it("returns diagnostics for a blocked publication detail", async () => {
    // Given forbidden public Markdown, when detail is requested, then its compiler diagnostic is returned.
    await writeFile(
      join(vault, "blocked.md"),
      knowledgeSource({
        privateId: "prv_blocked",
        publicId: "pub_blocked",
        title: "Blocked",
        slug: "/knowledge/blocked",
        body: "<script>forbidden</script>\n",
      }),
    );
    const publisher = await Publisher.open(configPath);

    const detail = await publisher.detail("pub_blocked");

    expect(detail.working).toBeNull();
    expect(detail.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ publicId: "pub_blocked", severity: "error" }),
      ]),
    );
  });

  it("exposes additive proposal changes and an honest unavailable release baseline", async () => {
    // Given one approved publication with a changed working source and one blocked source.
    const changedPath = join(vault, "changed.md");
    const changedSource = knowledgeSource({
      privateId: "prv_changed",
      publicId: "pub_changed",
      title: "Changed",
      slug: "/knowledge/changed",
      body: "Original body.\n",
    });
    await writeFile(changedPath, changedSource);
    await writeFile(
      join(vault, "blocked.md"),
      knowledgeSource({
        privateId: "prv_blocked",
        publicId: "pub_blocked",
        title: "Blocked",
        slug: "/knowledge/blocked",
        body: "<script>blocked</script>\n",
      }),
    );
    const publisher = await Publisher.open(configPath);
    const exposureHash = (await publisher.detail("pub_changed")).working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");
    await publisher.approve("pub_changed", exposureHash);
    await writeFile(changedPath, changedSource.replace("Original body.", "Changed body."));

    // When a plan is read without any successful-build receipt.
    const plan = await publisher.plan();

    // Then existing keys remain and proposal/release semantics are explicit.
    expect(plan).toMatchObject({
      publications: expect.any(Array),
      diagnostics: expect.any(Array),
      approved: expect.any(Array),
      redirects: expect.any(Array),
      changes: {
        proposals: {
          baseline: "active-approved",
          summary: { added: 0, updated: 1, unchanged: 0, blocked: 1, orphaned: 0 },
        },
        release: {
          baseline: "last-successful-build",
          available: false,
          reason: "missing-receipt",
        },
      },
    });
  });

  it("edits reviewed metadata with source-hash concurrency", async () => {
    // Given a candidate source, when metadata is patched, then CST prose survives and stale writes fail.
    const path = join(vault, "metadata.md");
    const source = knowledgeSource({
      privateId: "prv_metadata",
      publicId: "pub_metadata",
      title: "Old",
      slug: "/knowledge/old",
      body: "Body unchanged.  \n",
      comment: "metadata comment",
    });
    await writeFile(path, source);
    const publisher = await Publisher.open(configPath);

    const result = await publisher.updateMetadata(
      "pub_metadata",
      { title: "New", slug: "/knowledge/new" },
      hash(source),
    );

    const changed = await readFile(path, "utf8");
    expect(changed).toContain("# metadata comment");
    expect(changed).toContain("title: New");
    expect(changed.endsWith("Body unchanged.  \n")).toBe(true);
    await expect(
      publisher.updateMetadata("pub_metadata", { title: "Stale" }, result.previousHash),
    ).rejects.toMatchObject({ code: "CONCURRENT_SOURCE_MODIFICATION" });
  });
});
