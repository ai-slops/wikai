import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Publisher } from "./index.ts";
import { createServiceFixture } from "./test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;

function source(publicId: string, title: string, tags: readonly string[]): string {
  const tagLines = tags.map((tag) => `    - ${JSON.stringify(tag)}`).join("\n");
  return `---
id: prv_${publicId.slice(4)}
title: ${title}
tags:
  - Private/Fallback
public:
  id: ${publicId}
  status: review
  mode: mirror
  kind: knowledge
  slug: /knowledge/${publicId.slice(4)}
  summary: ${JSON.stringify(`${title} summary`)}
  contentState: stable
  tags:
${tagLines}
  knowledge:
    documentType: topic
---
# ${title}
`;
}

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Publisher tag management", () => {
  it("lists and filters only explicit public tags with multi-tag exact and subtree modes", async () => {
    // Given public documents with hierarchical tags and an unrelated private tag.
    await writeFile(
      join(vault, "react.md"),
      source("pub_react", "React", ["Engineering/Web/React", "Status/Stable"]),
    );
    await writeFile(
      join(vault, "vue.md"),
      source("pub_vue", "Vue", ["Engineering/Web/Vue", "Status/Draft"]),
    );
    const publisher = await Publisher.open(configPath);

    // When listed and filtered.
    const list = await publisher.tagList();
    const subtree = await publisher.filterByTags({
      tags: ["Engineering/Web", "Status/Stable"],
      mode: "subtree",
    });
    const exact = await publisher.filterByTags({ tags: ["Engineering/Web"], mode: "exact" });
    const privateFallback = await publisher.filterByTags({
      tags: ["Private/Fallback"],
      mode: "exact",
    });

    // Then inferred parents are listed, all queries are required, and private tags are ignored.
    expect(list).toContainEqual(
      expect.objectContaining({ path: "Engineering/Web", directCount: 0, descendantCount: 2 }),
    );
    expect(subtree.map((document) => document.publicId)).toEqual(["pub_react"]);
    expect(exact).toEqual([]);
    expect(privateFallback).toEqual([]);
  });

  it("returns a nested tree with inferred parents", async () => {
    // Given one authored leaf tag.
    await writeFile(join(vault, "react.md"), source("pub_react", "React", ["A/B/C"]));
    const publisher = await Publisher.open(configPath);

    // When the tree is requested, then all unstored ancestors are present.
    expect(await publisher.tagTree()).toMatchObject([
      { path: "A", directCount: 0, children: [{ path: "A/B", children: [{ path: "A/B/C" }] }] },
    ]);
  });

  it("plans and applies a hash-bound subtree rename without touching approvals or other tags", async () => {
    // Given an approved document and another current document sharing a tag subtree.
    const reactPath = join(vault, "react.md");
    const vuePath = join(vault, "vue.md");
    await writeFile(
      reactPath,
      source("pub_react", "React", ["Engineering/Web/React", "Status/Stable"]),
    );
    await writeFile(vuePath, source("pub_vue", "Vue", ["Engineering/Web/Vue", "Personal"]));
    const publisher = await Publisher.open(configPath);
    const exposureHash = (await publisher.detail("pub_react")).working?.exposureHash;
    if (exposureHash === undefined) throw new TypeError("working publication missing");
    const approved = await publisher.approve("pub_react", exposureHash);

    // When the reviewed subtree rename is applied.
    const plan = await publisher.planTagRename({
      from: "Engineering/Web",
      to: "Technology/Web",
      mode: "subtree",
    });
    const result = await publisher.applyTagRename({
      from: "Engineering/Web",
      to: "Technology/Web",
      mode: "subtree",
      expectedHash: plan.expectedHash,
    });

    // Then only current public tags change and the active approved snapshot remains byte-equivalent.
    expect(result.updated).toBe(2);
    expect(await readFile(reactPath, "utf8")).toContain("Technology/Web/React");
    expect(await readFile(reactPath, "utf8")).toContain("Status/Stable");
    expect(await readFile(vuePath, "utf8")).toContain("Personal");
    expect((await publisher.preview("approved", "pub_react")).publications[0]).toEqual(approved);
  });

  it("rejects a rename plan after any selected source changes", async () => {
    // Given a reviewed multi-document rename plan.
    const reactPath = join(vault, "react.md");
    const original = source("pub_react", "React", ["Engineering/Web/React"]);
    await writeFile(reactPath, original);
    const publisher = await Publisher.open(configPath);
    const input = { from: "Engineering", to: "Technology", mode: "subtree" as const };
    const plan = await publisher.planTagRename(input);
    await writeFile(reactPath, original.replace("# React", "# Concurrent edit"));

    // When applied with the old hash, then the mixed edit is retained and no rename occurs.
    await expect(
      publisher.applyTagRename({ ...input, expectedHash: plan.expectedHash }),
    ).rejects.toMatchObject({ code: "STALE_TAG_RENAME" });
    expect(await readFile(reactPath, "utf8")).toContain("# Concurrent edit");
    expect(await readFile(reactPath, "utf8")).toContain("Engineering/Web/React");
  });
});
