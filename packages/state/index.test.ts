import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withLock } from "../fs/index.ts";
import type { WorkingPublication } from "../model/index.ts";
import { PublisherState } from "./index.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-state-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function working(overrides: Partial<WorkingPublication> = {}): WorkingPublication {
  const publication: WorkingPublication = {
    publicId: "pub_note",
    sourceId: "prv_note",
    sourcePath: "note.md",
    sourceHash: hash("source"),
    sourceMode: "mirror",
    workflowStatus: "review",
    metadata: {
      id: "pub_note",
      kind: "knowledge",
      slug: "/knowledge/example",
      title: "Example",
      tags: [],
      aliases: [],
      featured: false,
      listed: true,
      index: true,
      feed: true,
    },
    markdown: "# Example\n\nPublic.",
    html: "<h1>Example</h1><p>Public.</p>",
    outgoingLinks: [],
    assets: [],
    sources: [],
    exposureHash: hash("exposure-1"),
    diagnostics: [],
  };
  return { ...publication, ...overrides };
}

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("immutable publisher state", () => {
  it("approves the exact expected exposure and retains immutable history", async () => {
    // Given a working publication, when it is approved twice, then both revisions remain readable.
    const state = await PublisherState.open(root);
    const firstWorking = working();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = working({
      markdown: "# Example\n\nChanged.",
      html: "<h1>Example</h1><p>Changed.</p>",
      exposureHash: hash("exposure-2"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);

    expect((await state.history("pub_note")).map((revision) => revision.revisionHash)).toEqual([
      first.revisionHash,
      second.revisionHash,
    ]);
    expect((await state.approved("pub_note"))?.revisionHash).toBe(second.revisionHash);
  });

  it("rejects a stale approval without changing active state", async () => {
    // Given a changed working exposure, when the old hash is approved, then no revision is activated.
    const state = await PublisherState.open(root);
    await expect(state.approve(working(), hash("stale"))).rejects.toMatchObject({
      code: "STALE_EXPOSURE_HASH",
    });
    expect(await state.approved("pub_note")).toBeNull();
  });

  it("withdraws without deleting history and restores an earlier revision", async () => {
    // Given an approved revision, when withdrawn then restored, then history and content survive.
    const state = await PublisherState.open(root);
    const publication = working();
    const revision = await state.approve(publication, publication.exposureHash);
    await state.withdraw("pub_note", revision.exposureHash, "/archive/example");
    expect(await state.approved("pub_note")).toBeNull();

    const restored = await state.restore("pub_note", revision.revisionHash, revision.exposureHash);
    expect(restored.revisionHash).toBe(revision.revisionHash);
    expect(await state.history("pub_note")).toHaveLength(1);
  });

  it("reserves withdrawn slugs and aliases case-insensitively", async () => {
    // Given withdrawn names, when another publication claims them, then collision is rejected.
    const state = await PublisherState.open(root);
    const firstWorking = working({
      metadata: { ...working().metadata, aliases: ["/knowledge/old-example"] },
    });
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    await state.withdraw(first.publicId, first.exposureHash);

    const other = working({
      publicId: "pub_other",
      sourceId: "prv_other",
      metadata: {
        ...working().metadata,
        id: "pub_other",
        slug: "/KNOWLEDGE/OLD-EXAMPLE",
        aliases: [],
      },
      exposureHash: hash("other"),
    });
    await expect(state.approve(other, other.exposureHash)).rejects.toMatchObject({
      code: "SLUG_COLLISION",
    });
  });

  it("detects tampering with an immutable revision on read", async () => {
    // Given a modified revision file, when state is read, then integrity verification fails.
    const state = await PublisherState.open(root);
    const publication = working();
    const revision = await state.approve(publication, publication.exposureHash);
    const path = join(root, "revisions", publication.publicId, `${revision.revisionHash}.json`);
    const stored = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...stored, markdown: "tampered" }));

    await expect(state.approved(publication.publicId)).rejects.toMatchObject({
      code: "REVISION_INTEGRITY_FAILURE",
    });
  });

  it("does not create the state directory for read-only access", async () => {
    // Given absent state, when read methods open it, then the filesystem remains untouched.
    const stateDir = join(root, "missing-state");
    const state = await PublisherState.open(stateDir);

    expect(await state.approved("pub_missing")).toBeNull();
    await expect(stat(stateDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks restore concurrency against the current withdrawn revision", async () => {
    // Given two revisions and a withdrawal, when restoring older content, then expect the latest hash.
    const state = await PublisherState.open(root);
    const firstWorking = working();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = working({
      markdown: "# Example\n\nSecond.",
      html: "<h1>Example</h1><p>Second.</p>",
      exposureHash: hash("exposure-2"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    await state.withdraw(second.publicId, second.exposureHash);

    await expect(
      state.restore(first.publicId, first.revisionHash, first.exposureHash),
    ).rejects.toMatchObject({ code: "STALE_EXPOSURE_HASH" });
    expect(
      (await state.restore(first.publicId, first.revisionHash, second.exposureHash)).revisionHash,
    ).toBe(first.revisionHash);
  });

  it("reserves a public ID for its original private source", async () => {
    // Given an approved ID, when another private source reuses it, then ownership is rejected.
    const state = await PublisherState.open(root);
    const original = working();
    const approved = await state.approve(original, original.exposureHash);
    await state.withdraw(original.publicId, approved.exposureHash);
    const impersonator = working({
      sourceId: "prv_other",
      sourcePath: "other.md",
      exposureHash: hash("other-source"),
    });

    await expect(state.approve(impersonator, impersonator.exposureHash)).rejects.toMatchObject({
      code: "PUBLIC_ID_COLLISION",
    });
  });

  it("preserves the first publication timestamp across reapproval", async () => {
    // Given a first approval, when updated content is approved, then publishedAt remains stable.
    const state = await PublisherState.open(root);
    const original = working();
    const first = await state.approve(original, original.exposureHash);
    const update = working({
      markdown: "# Example\n\nUpdated.",
      html: "<h1>Example</h1><p>Updated.</p>",
      exposureHash: hash("updated"),
    });
    const second = await state.approve(update, update.exposureHash);

    expect(first.metadata.publishedAt).toBeTypeOf("string");
    expect(second.metadata.publishedAt).toBe(first.metadata.publishedAt);
  });

  it("captures approval source state while holding the publication lock", async () => {
    // Given approval capture, when it attempts another state lock, then lock contention proves ordering.
    const state = await PublisherState.open(root);
    const publication = working();

    await expect(
      state.approve(publication, publication.exposureHash, async () => {
        await withLock(root, async () => undefined);
        return { working: publication, sourceHash: publication.sourceHash, sources: [] };
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_LOCKED" });
    expect(await state.approved(publication.publicId)).toBeNull();
  });

  it("rejects an active revision hash outside its publication history", async () => {
    // Given tampered cross-publication state, when snapshot loads it, then integrity parsing fails closed.
    const state = await PublisherState.open(root);
    const firstWorking = working();
    await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = working({
      publicId: "pub_other",
      sourceId: "prv_other",
      sourcePath: "other.md",
      metadata: { ...working().metadata, id: "pub_other", slug: "/knowledge/other" },
      exposureHash: hash("other"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    const statePath = join(root, "state.json");
    const stored = JSON.parse(await readFile(statePath, "utf8"));
    stored.publications.pub_note.activeRevisionHash = second.revisionHash;
    await writeFile(statePath, JSON.stringify(stored));

    await expect(state.snapshot()).rejects.toMatchObject({ code: "STATE_INTEGRITY_FAILURE" });
  });

  it("rejects a revision whose identity does not match its requested coordinates", async () => {
    // Given a copied revision under another public ID, when loaded, then coordinate verification fails.
    const state = await PublisherState.open(root);
    const firstWorking = working();
    await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = working({
      publicId: "pub_other",
      sourceId: "prv_other",
      sourcePath: "other.md",
      metadata: { ...working().metadata, id: "pub_other", slug: "/knowledge/other" },
      exposureHash: hash("other"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    const copied = await readFile(
      join(root, "revisions", "pub_other", `${second.revisionHash}.json`),
      "utf8",
    );
    await writeFile(join(root, "revisions", "pub_note", `${second.revisionHash}.json`), copied);
    const statePath = join(root, "state.json");
    const stored = JSON.parse(await readFile(statePath, "utf8"));
    stored.publications.pub_note.activeRevisionHash = second.revisionHash;
    stored.publications.pub_note.revisionHashes.push(second.revisionHash);
    stored.publications.pub_note.revisionSourceHashes[second.revisionHash] = hash("source");
    stored.publications.pub_note.revisionSources[second.revisionHash] = [];
    await writeFile(statePath, JSON.stringify(stored));

    await expect(state.approved("pub_note")).rejects.toMatchObject({
      code: "REVISION_INTEGRITY_FAILURE",
    });
  });

  it("rejects unsafe withdrawal redirects", async () => {
    // Given an approved publication, when a script URL redirect is requested, then mutation is rejected.
    const state = await PublisherState.open(root);
    const publication = working();
    const revision = await state.approve(publication, publication.exposureHash);

    await expect(
      state.withdraw(publication.publicId, revision.exposureHash, "javascript:alert(1)"),
    ).rejects.toMatchObject({ code: "INVALID_REDIRECT" });
    expect((await state.approved(publication.publicId))?.revisionHash).toBe(revision.revisionHash);
  });
});
