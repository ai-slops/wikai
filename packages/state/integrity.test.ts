import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { WorkingPublication } from "../model/index.ts";
import { PublisherState } from "./index.ts";

let root: string;
const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-integrity-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function working(): WorkingPublication {
  return {
    publicId: "pub_note",
    sourceId: "prv_note",
    sourcePath: "note.md",
    sourceHash: hash("source"),
    sourceMode: "mirror",
    workflowStatus: "review",
    metadata: {
      id: "pub_note",
      kind: "knowledge",
      slug: "/knowledge/note",
      title: "Note",
      tags: [],
      aliases: [],
      featured: false,
      listed: true,
      index: true,
      feed: true,
    },
    markdown: "# Note\n",
    html: "<h1>Note</h1>",
    outgoingLinks: [],
    assets: [],
    sources: [],
    diagnostics: [],
    exposureHash: hash("exposure"),
  };
}

it("rejects unsafe redirects loaded from persisted state", async () => {
  // Given a tampered persisted redirect, when state is read, then integrity parsing fails closed.
  const state = await PublisherState.open(root);
  const publication = working();
  const revision = await state.approve(publication, publication.exposureHash);
  await state.withdraw(publication.publicId, revision.exposureHash, "/archive/note");
  const path = join(root, "state.json");
  const stored = JSON.parse(await readFile(path, "utf8"));
  stored.publications.pub_note.withdrawalRedirect = "javascript:alert(1)";
  await writeFile(path, JSON.stringify(stored));

  await expect(state.snapshot()).rejects.toMatchObject({ code: "STATE_INTEGRITY_FAILURE" });
});

it("rejects a changed exposure returned by in-lock approval capture", async () => {
  // Given stale compiled content, when in-lock capture sees a new exposure, then approval is rejected.
  const state = await PublisherState.open(root);
  const publication = working();
  const changed = { ...publication, exposureHash: hash("changed") };

  await expect(
    state.approve(publication, publication.exposureHash, async () => ({
      working: changed,
      sourceHash: changed.sourceHash,
      sources: changed.sources,
    })),
  ).rejects.toMatchObject({ code: "STALE_EXPOSURE_HASH" });
  expect(await state.approved(publication.publicId)).toBeNull();
});
