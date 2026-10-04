import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hash, withLock } from "../fs/index.ts";
import { releasePolicyHash } from "../release/receipt.ts";
import { PublisherState } from "./index.ts";
import {
  applyRevisionGc,
  applySlugRelease,
  planRevisionGc,
  planSlugRelease,
} from "./operations.ts";
import { workingPublication } from "./test-fixture.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-state-operations-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("state operational plans", () => {
  it("records review time on approval and restore while preserving deployment state", async () => {
    const state = await PublisherState.open(root);
    const working = workingPublication();
    const revision = await state.approve(working, working.exposureHash);
    const approvedReview = (await state.reviewTimes())["pub_note"];
    await state.recordDeployment({ pub_note: revision.revisionHash });
    await state.withdraw(revision.publicId, revision.exposureHash);
    await state.restore(revision.publicId, revision.revisionHash, revision.exposureHash);

    expect(approvedReview).toBeTypeOf("string");
    expect((await state.reviewTimes())["pub_note"]).toBeTypeOf("string");
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8"))).toMatchObject({
      publications: {
        pub_note: {
          lastDeployedRevision: revision.revisionHash,
          lastReviewedAt: expect.any(String),
        },
      },
    });
  });

  it("rejects incomplete deployment bookkeeping without changing prior markers", async () => {
    const state = await PublisherState.open(root);
    const firstWorking = workingPublication();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = workingPublication({
      publicId: "pub_second",
      sourceId: "prv_second",
      sourcePath: "second.md",
      metadata: {
        ...firstWorking.metadata,
        id: "pub_second",
        slug: "/knowledge/second",
        aliases: [],
      },
      exposureHash: hash("second-publication"),
    });
    await state.approve(secondWorking, secondWorking.exposureHash);

    await expect(state.recordDeployment({ pub_note: first.revisionHash })).rejects.toMatchObject({
      code: "DEPLOYMENT_STATE_CHANGED",
    });
    expect(await readFile(join(root, "state.json"), "utf8")).not.toContain("lastDeployedRevision");
  });

  it("releases only an inactive unreferenced slug through a reviewed plan", async () => {
    const state = await PublisherState.open(root);
    const working = workingPublication();
    const revision = await state.approve(working, working.exposureHash);
    await state.withdraw(revision.publicId, revision.exposureHash);

    const plan = await planSlugRelease({
      stateDir: root,
      publicId: revision.publicId,
      slug: "/knowledge/old-note",
    });
    expect(plan).toMatchObject({ canApply: true, ownerId: "pub_note" });
    await applySlugRelease(
      { stateDir: root, publicId: revision.publicId, slug: "/knowledge/old-note" },
      plan.planHash,
    );

    const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    expect(stored.publications.pub_note.reservedSlugs).toEqual(["/knowledge/note"]);
  });

  it("blocks current names, active link destinations, active redirects, and foreign ownership", async () => {
    const state = await PublisherState.open(root);
    const firstWorking = workingPublication();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    expect(
      await planSlugRelease({ stateDir: root, publicId: first.publicId, slug: "/knowledge/note" }),
    ).toMatchObject({ canApply: false });
    await state.withdraw(first.publicId, first.exposureHash, "/archive/note");
    const linked = workingPublication({
      publicId: "pub_linked",
      sourceId: "prv_linked",
      sourcePath: "linked.md",
      metadata: {
        ...firstWorking.metadata,
        id: "pub_linked",
        slug: "/knowledge/linked",
        aliases: [],
      },
      outgoingLinks: [{ publicId: "pub_note", slug: "/knowledge/old-note", title: "Old note" }],
      exposureHash: hash("linked"),
    });
    await state.approve(linked, linked.exposureHash);

    expect(
      await planSlugRelease({
        stateDir: root,
        publicId: first.publicId,
        slug: "/knowledge/old-note",
      }),
    ).toMatchObject({ canApply: false });
    expect(
      await planSlugRelease({
        stateDir: root,
        publicId: "pub_linked",
        slug: "/knowledge/old-note",
      }),
    ).toMatchObject({ canApply: false, ownerId: "pub_note" });
  });

  it("rejects stale and locked slug release plans without mutation", async () => {
    const state = await PublisherState.open(root);
    const working = workingPublication();
    const revision = await state.approve(working, working.exposureHash);
    await state.withdraw(revision.publicId, revision.exposureHash);
    const input = { stateDir: root, publicId: revision.publicId, slug: "/knowledge/old-note" };
    const plan = await planSlugRelease(input);
    const statePath = join(root, "state.json");
    await writeFile(statePath, `${await readFile(statePath, "utf8")} \n`);
    await expect(applySlugRelease(input, plan.planHash)).rejects.toMatchObject({
      code: "STALE_STATE_PLAN",
    });
    const currentPlan = await planSlugRelease(input);
    await expect(
      withLock(root, () => applySlugRelease(input, currentPlan.planHash)),
    ).rejects.toMatchObject({ code: "PUBLICATION_LOCKED" });
  });

  it("keeps active and last-deployed revisions while pruning state before files", async () => {
    const state = await PublisherState.open(root);
    const initial = workingPublication();
    const first = await state.approve(initial, initial.exposureHash);
    await state.recordDeployment({ pub_note: first.revisionHash });
    const secondWorking = workingPublication({
      markdown: "Second",
      html: "<p>Second</p>",
      exposureHash: hash("second"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    const thirdWorking = workingPublication({
      markdown: "Third",
      html: "<p>Third</p>",
      exposureHash: hash("third"),
    });
    const third = await state.approve(thirdWorking, thirdWorking.exposureHash);

    const input = { stateDir: root, retainHistory: 0 };
    const plan = await planRevisionGc(input);
    expect(plan.remove).toEqual([{ publicId: "pub_note", revisionHash: second.revisionHash }]);
    await applyRevisionGc(input, plan.planHash);

    expect((await state.history("pub_note")).map((item) => item.revisionHash)).toEqual([
      first.revisionHash,
      third.revisionHash,
    ]);
    await expect(
      readFile(join(root, "revisions", "pub_note", `${second.revisionHash}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on corrupt revision inventory", async () => {
    const state = await PublisherState.open(root);
    const working = workingPublication();
    const revision = await state.approve(working, working.exposureHash);
    await writeFile(
      join(root, "revisions", revision.publicId, `${revision.revisionHash}.json`),
      "corrupt",
    );

    const plan = await planRevisionGc({ stateDir: root, retainHistory: 0 });
    expect(plan.canApply).toBe(false);
    await expect(
      applyRevisionGc({ stateDir: root, retainHistory: 0 }, plan.planHash),
    ).rejects.toMatchObject({ code: "STATE_MAINTENANCE_BLOCKED" });
  });

  it("retains revisions referenced by every current and previous deployment generation", async () => {
    const state = await PublisherState.open(root);
    const firstWorking = workingPublication();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    const secondWorking = workingPublication({
      markdown: "Second",
      html: "<p>Second</p>",
      exposureHash: hash("second-evidence"),
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    const thirdWorking = workingPublication({
      markdown: "Third",
      html: "<p>Third</p>",
      exposureHash: hash("third-evidence"),
    });
    await state.approve(thirdWorking, thirdWorking.exposureHash);
    const deploymentRoot = join(root, "deployments");
    for (const [name, revisionHash] of [
      [hash("production").slice("sha256:".length), second.revisionHash],
      [`${hash("production").slice("sha256:".length)}.previous`, first.revisionHash],
      [hash("preview").slice("sha256:".length), first.revisionHash],
    ] as const) {
      const evidence = join(deploymentRoot, name);
      await mkdir(evidence, { recursive: true });
      for (const policy of ["content-index.json", "publication-manifest.json", "redirects.json"]) {
        await writeFile(join(evidence, policy), JSON.stringify({ policy }));
      }
      await writeFile(
        join(evidence, "deployment.json"),
        JSON.stringify({
          schemaVersion: 1,
          destination: join(root, name),
          revisions: { pub_note: revisionHash },
          redirectsHash: hash("redirects"),
          stagingPolicyHash: await releasePolicyHash(evidence),
          distFingerprintHash: hash("dist"),
        }),
      );
    }

    const plan = await planRevisionGc({ stateDir: root, retainHistory: 0 });

    expect(plan.canApply).toBe(true);
    expect(plan.remove).toEqual([]);
  });

  it.each(["malformed", "unreadable"])(
    "fails closed when persisted deployment evidence is %s",
    async (failure) => {
      const state = await PublisherState.open(root);
      const working = workingPublication();
      await state.approve(working, working.exposureHash);
      const evidence = join(root, "deployments", hash("production").slice("sha256:".length));
      await mkdir(evidence, { recursive: true });
      const document = join(evidence, "deployment.json");
      if (failure === "malformed") await writeFile(document, "not-json");
      else await mkdir(document);

      const plan = await planRevisionGc({ stateDir: root, retainHistory: 0 });

      expect(plan.canApply).toBe(false);
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({ code: "DEPLOYMENT_EVIDENCE_INVALID" }),
      );
    },
  );
});
