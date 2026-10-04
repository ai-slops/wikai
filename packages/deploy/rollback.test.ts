import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublisherState } from "../state/index.ts";
import { applyRevisionGc, planRevisionGc } from "../state/operations.ts";
import {
  applyDirectoryDeployment,
  applyDirectoryRollback,
  planDirectoryDeployment,
  planDirectoryRollback,
} from "./index.ts";
import {
  createDeploymentFixture,
  type DeploymentFixture,
  deploymentPublication,
  writeAuditedDist,
  writeReleaseReceipt,
} from "./test-fixture.ts";

let fixture: DeploymentFixture;

beforeEach(async () => {
  fixture = await createDeploymentFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("local directory rollback", () => {
  it("atomically swaps the retained previous deployment", async () => {
    const { config, deployments, destination } = fixture;
    const input = { config, deployments, environment: "production" };
    const firstPlan = await planDirectoryDeployment(input);
    await applyDirectoryDeployment(input, firstPlan.planHash);
    await rm(config.site.distDir, { recursive: true });
    await mkdir(config.site.distDir);
    await writeAuditedDist(config, "second");
    await writeReleaseReceipt(config, {});
    const secondPlan = await planDirectoryDeployment(input);
    await applyDirectoryDeployment(input, secondPlan.planHash);

    const rollback = await planDirectoryRollback(input);
    await applyDirectoryRollback(input, rollback.planHash);

    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("first");
  });

  it("uses retained policy, preserves stale output, and records prior revisions", async () => {
    const { config, deployments, destination } = fixture;
    const state = await PublisherState.open(config.publisher.stateDir);
    const firstWorking = deploymentPublication();
    const firstRevision = await state.approve(firstWorking, firstWorking.exposureHash);
    await writeReleaseReceipt(config, { pub_note: firstRevision.revisionHash });
    const input = { config, deployments, environment: "production" };
    const firstPlan = await planDirectoryDeployment(input);
    await applyDirectoryDeployment(input, firstPlan.planHash);

    const secondWorking = deploymentPublication({
      markdown: "Second",
      html: "<p>Second</p>",
      exposureHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const secondRevision = await state.approve(secondWorking, secondWorking.exposureHash);
    await rm(config.site.distDir, { recursive: true });
    await mkdir(config.site.distDir);
    await writeAuditedDist(config, "second");
    await writeReleaseReceipt(config, { pub_note: secondRevision.revisionHash });
    const secondPlan = await planDirectoryDeployment(input);
    await applyDirectoryDeployment(input, secondPlan.planHash);

    await writeFile(
      join(config.publisher.releaseStagingDir, "publication-manifest.json"),
      JSON.stringify({ schemaVersion: 1, pages: [{ id: "current-policy" }] }),
    );
    const rollback = await planDirectoryRollback(input);
    expect(rollback.canApply).toBe(true);
    const previousIndex = `${destination}.previous/index.html`;
    await writeFile(previousIndex, "changed after review");
    await expect(applyDirectoryRollback(input, rollback.planHash)).rejects.toMatchObject({
      code: "DEPLOYMENT_EVIDENCE_INVALID",
    });
    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("second");

    await writeFile(previousIndex, "first");
    const currentRollback = await planDirectoryRollback(input);
    await applyDirectoryRollback(input, currentRollback.planHash);

    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("first");
    expect(
      JSON.parse(await readFile(join(config.publisher.stateDir, "state.json"), "utf8")),
    ).toMatchObject({
      publications: { pub_note: { lastDeployedRevision: firstRevision.revisionHash } },
    });
  });

  it("remains rollbackable after zero-history revision garbage collection", async () => {
    const { config, deployments, destination } = fixture;
    const state = await PublisherState.open(config.publisher.stateDir);
    const firstWorking = deploymentPublication();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    await writeReleaseReceipt(config, { pub_note: first.revisionHash });
    const input = { config, deployments, environment: "production" };
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    const secondWorking = deploymentPublication({
      markdown: "Second",
      html: "<p>Second</p>",
      exposureHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    const second = await state.approve(secondWorking, secondWorking.exposureHash);
    await rm(config.site.distDir, { recursive: true });
    await mkdir(config.site.distDir);
    await writeAuditedDist(config, "second");
    await writeReleaseReceipt(config, { pub_note: second.revisionHash });
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    const gcInput = { stateDir: config.publisher.stateDir, retainHistory: 0 };
    const gcPlan = await planRevisionGc(gcInput);
    await applyRevisionGc(gcInput, gcPlan.planHash);

    const rollback = await planDirectoryRollback(input);
    await applyDirectoryRollback(input, rollback.planHash);

    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("first");
    expect((await state.history("pub_note")).map((revision) => revision.revisionHash)).toEqual([
      first.revisionHash,
      second.revisionHash,
    ]);
  });

  it("restores both generations when the third output rename fails", async () => {
    const { config, deployments, destination } = fixture;
    const input = { config, deployments, environment: "production" };
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    await rm(config.site.distDir, { recursive: true });
    await mkdir(config.site.distDir);
    await writeAuditedDist(config, "second");
    await writeReleaseReceipt(config, {});
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    const plan = await planDirectoryRollback(input);
    let renames = 0;
    const faultedInput = {
      ...input,
      fileOperations: {
        rename: async (source: string, target: string) => {
          renames += 1;
          if (renames === 3) throw new Error("injected third rename failure");
          await rename(source, target);
        },
        syncDirectory: async (path: string) => {
          const directory = await open(path, "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        },
      },
    };

    await expect(applyDirectoryRollback(faultedInput, plan.planHash)).rejects.toThrow(
      "injected third rename failure",
    );
    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("second");
    expect(await readFile(join(`${destination}.previous`, "index.html"), "utf8")).toBe("first");
  });

  it("compensates both swaps when parent fsync fails before bookkeeping", async () => {
    const { config, deployments, destination } = fixture;
    const input = { config, deployments, environment: "production" };
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    await rm(config.site.distDir, { recursive: true });
    await mkdir(config.site.distDir);
    await writeAuditedDist(config, "second");
    await writeReleaseReceipt(config, {});
    await applyDirectoryDeployment(input, (await planDirectoryDeployment(input)).planHash);
    const stateBefore = await readFile(join(config.publisher.stateDir, "state.json"), "utf8");
    const plan = await planDirectoryRollback(input);
    let syncs = 0;
    const faultedInput = {
      ...input,
      fileOperations: {
        rename,
        syncDirectory: async (path: string) => {
          syncs += 1;
          if (syncs === 2) throw new Error("injected evidence fsync failure");
          const directory = await open(path, "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        },
      },
    };

    await expect(applyDirectoryRollback(faultedInput, plan.planHash)).rejects.toThrow(
      "injected evidence fsync failure",
    );
    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("second");
    expect(await readFile(join(`${destination}.previous`, "index.html"), "utf8")).toBe("first");
    expect(await readFile(join(config.publisher.stateDir, "state.json"), "utf8")).toBe(stateBefore);
  });
});
