import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { MdxSnapshot } from "../model/index.ts";
import { PublisherState } from "./index.ts";
import { revisionContent } from "./revision.ts";
import { workingPublication } from "./test-fixture.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const mdx = (script: string): MdxSnapshot => ({
  schemaVersion: 1,
  contentInputHash: hash("authored mdx"),
  profileDigest: hash("runtime and dependencies"),
  runtime: {
    image: "wikai-mdx:local",
    lockHash: hash("lock"),
    runtimeHash: hash("runtime"),
  },
  dependencies: [],
  artifact: {
    html: {
      path: "index.html",
      hash: hash('<div id="wikai-mdx-root">Counter</div>'),
      mime: "text/html; charset=utf-8",
      bytes: 40,
      data: Buffer.from('<div id="wikai-mdx-root">Counter</div>').toString("base64"),
    },
    scripts: [
      {
        path: "client.js",
        hash: hash(script),
        mime: "text/javascript; charset=utf-8",
        bytes: Buffer.byteLength(script),
        data: Buffer.from(script).toString("base64"),
      },
    ],
    styles: [],
  },
});

it("preserves the legacy revision hash when MDX is absent", () => {
  // Given a fixed approved revision using only the legacy Markdown fields.
  const revision = {
    publicId: "pub_legacy",
    revisionHash: "",
    exposureHash: hash("exposure"),
    metadata: {
      id: "pub_legacy",
      kind: "knowledge" as const,
      slug: "/knowledge/legacy",
      title: "Legacy",
      tags: [],
      aliases: [],
      featured: false,
      listed: true,
      index: true,
      feed: true,
    },
    markdown: "Legacy",
    html: "<p>Legacy</p>",
    outgoingLinks: [],
    assets: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
  };

  // When its canonical revision content is hashed by the extended model.
  const revisionHash = hash(revisionContent(revision));

  // Then it remains byte-for-byte compatible with the pre-MDX hash contract.
  expect(revisionHash).toBe(
    "sha256:b025457fb5f82636327181dbfea391c3171d1a1d41134ff6586af7b36d0e74a6",
  );
});

it("restores the exact approved MDX bytes after shared dependencies change", async () => {
  // Given two approvals generated from different dependency profiles.
  const root = await mkdtemp(join(tmpdir(), "wikai-state-mdx-"));
  roots.push(root);
  const state = await PublisherState.open(root);
  const firstWorking = workingPublication({ mdx: mdx("first bytes"), exposureHash: hash("first") });
  const first = await state.approve(firstWorking, firstWorking.exposureHash);
  const secondWorking = workingPublication({
    mdx: mdx("second bytes"),
    exposureHash: hash("second"),
  });
  const second = await state.approve(secondWorking, secondWorking.exposureHash);
  await state.withdraw(second.publicId, second.exposureHash);

  // When the first approval is restored using the current concurrency hash.
  const restored = await state.restore(first.publicId, first.revisionHash, second.exposureHash);

  // Then restoration returns the prior immutable client artifact, not rebuilt bytes.
  expect(Buffer.from(restored.mdx?.artifact.scripts[0]?.data ?? "", "base64").toString()).toBe(
    "first bytes",
  );
});
