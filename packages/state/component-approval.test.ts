import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { MdxSnapshot } from "../model/index.ts";
import { PublisherState } from "./index.ts";
import { workingPublication } from "./test-fixture.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const mdx = (profile: string, script: string): MdxSnapshot => ({
  schemaVersion: 1,
  contentInputHash: hash("authored mdx"),
  profileDigest: hash(profile),
  runtime: { image: "wikai-mdx:local", lockHash: hash("lock"), runtimeHash: hash("runtime") },
  dependencies: [],
  artifact: {
    html: {
      path: "index.html",
      hash: hash(script),
      mime: "text/html; charset=utf-8",
      bytes: Buffer.byteLength(script),
      data: Buffer.from(script).toString("base64"),
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

it("activates a component batch once while preserving the old immutable snapshot", async () => {
  // Given an approved MDX revision and a reviewed profile-only replacement.
  const root = await mkdtemp(join(tmpdir(), "wikai-component-state-"));
  roots.push(root);
  const state = await PublisherState.open(root);
  const beforeWorking = workingPublication({ mdx: mdx("before", "old bytes") });
  const before = await state.approve(beforeWorking, beforeWorking.exposureHash);
  const afterWorking = workingPublication({
    sourceHash: hash("current source"),
    exposureHash: hash("new exposure"),
    mdx: mdx("after", "new bytes"),
  });
  const planHash = hash("reviewed component batch");

  // When the reviewed batch is applied under the state lock.
  const result = await state.approveComponentUpdates(planHash, async (active) => ({
    planHash,
    approvals: [
      {
        working: afterWorking,
        sourceHash: afterWorking.sourceHash,
        sources: afterWorking.sources,
        expectedActiveRevisionHash: before.revisionHash,
        expectedActiveExposureHash: before.exposureHash,
        expectedDesiredExposureHash: afterWorking.exposureHash,
        expectedContentInputHash: afterWorking.mdx?.contentInputHash ?? "",
        expectedProfileDigest: afterWorking.mdx?.profileDigest ?? "",
        expectedSourceHash: afterWorking.sourceHash,
      },
    ],
    active,
  }));

  // Then the new profile is active and the prior artifact remains in immutable history.
  expect(result.approved).toHaveLength(1);
  expect((await state.approved(before.publicId))?.mdx?.profileDigest).toBe(
    afterWorking.mdx?.profileDigest,
  );
  const history = await state.history(before.publicId);
  expect(Buffer.from(history[0]?.mdx?.artifact.scripts[0]?.data ?? "", "base64").toString()).toBe(
    "old bytes",
  );
});

it("rejects a stale whole-plan hash before activating any publication", async () => {
  // Given two active approvals and a callback that recomputes a different whole plan.
  const root = await mkdtemp(join(tmpdir(), "wikai-component-stale-"));
  roots.push(root);
  const state = await PublisherState.open(root);
  const firstWorking = workingPublication({ mdx: mdx("before", "first") });
  const first = await state.approve(firstWorking, firstWorking.exposureHash);
  const desired = workingPublication({
    exposureHash: hash("desired"),
    mdx: mdx("after", "changed"),
  });

  // When apply re-evaluates to a different hash under lock.
  await expect(
    state.approveComponentUpdates(hash("reviewed"), async (active) => ({
      planHash: hash("changed"),
      approvals: [
        {
          working: desired,
          sourceHash: desired.sourceHash,
          sources: desired.sources,
          expectedActiveRevisionHash: first.revisionHash,
          expectedActiveExposureHash: first.exposureHash,
          expectedDesiredExposureHash: desired.exposureHash,
          expectedContentInputHash: desired.mdx?.contentInputHash ?? "",
          expectedProfileDigest: desired.mdx?.profileDigest ?? "",
          expectedSourceHash: desired.sourceHash,
        },
      ],
      active,
    })),
  ).rejects.toMatchObject({ code: "STALE_COMPONENT_PLAN" });

  // Then no partial activation occurred.
  expect((await state.approved(first.publicId))?.revisionHash).toBe(first.revisionHash);
});
