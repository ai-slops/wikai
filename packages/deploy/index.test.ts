import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublisherState } from "../state/index.ts";
import { applyDirectoryDeployment, planDirectoryDeployment } from "./index.ts";
import {
  createDeploymentFixture,
  type DeploymentFixture,
  deploymentPublication,
  writeReleaseReceipt,
} from "./test-fixture.ts";

let fixture: DeploymentFixture;

beforeEach(async () => {
  fixture = await createDeploymentFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("local directory deployment", () => {
  it("requires explicit configuration and rejects protected destinations", async () => {
    const { config, root } = fixture;
    await expect(
      planDirectoryDeployment({ config, deployments: {}, environment: "production" }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_NOT_CONFIGURED" });
    await expect(
      planDirectoryDeployment({
        config,
        deployments: { production: { type: "directory", root: config.vault.root } },
        environment: "production",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_DEPLOYMENT_PATH" });

    for (const protectedRoot of [join(root, "public-view"), join(root, "asset-source")]) {
      const protectedConfig = {
        ...config,
        publicViews: { roots: [join(root, "public-view")] },
        assets: { ...config.assets, roots: [join(root, "asset-source")] },
      };
      await expect(
        planDirectoryDeployment({
          config: protectedConfig,
          deployments: { production: { type: "directory", root: protectedRoot } },
          environment: "production",
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_DEPLOYMENT_PATH" });
    }

    const privateRoot = join(root, "private-source");
    const privateAlias = join(root, "private-alias");
    await mkdir(privateRoot);
    await symlink(privateRoot, privateAlias);
    await expect(
      planDirectoryDeployment({
        config: { ...config, vault: { ...config.vault, root: privateAlias } },
        deployments: {
          production: { type: "directory", root: join(privateRoot, "published") },
        },
        environment: "production",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_DEPLOYMENT_PATH" });
  });

  it("audits the exact copied dist before promotion and records success afterward", async () => {
    const { config, deployments, destination } = fixture;
    const state = await PublisherState.open(config.publisher.stateDir);
    const working = deploymentPublication();
    const revision = await state.approve(working, working.exposureHash);
    await writeReleaseReceipt(config, { pub_note: revision.revisionHash });
    await mkdir(destination);
    await writeFile(join(destination, "old.txt"), "old");

    const input = { config, deployments, environment: "production" };
    const plan = await planDirectoryDeployment(input);
    await applyDirectoryDeployment(input, plan.planHash);

    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("first");
    expect(await readFile(`${destination}.previous/old.txt`, "utf8")).toBe("old");
    expect(
      JSON.parse(await readFile(join(config.publisher.stateDir, "state.json"), "utf8")),
    ).toMatchObject({
      publications: { pub_note: { lastDeployedRevision: revision.revisionHash } },
    });
  });

  it("preserves the destination and bookkeeping when audit or plan evidence fails", async () => {
    const { config, deployments, destination } = fixture;
    const state = await PublisherState.open(config.publisher.stateDir);
    const working = deploymentPublication();
    const revision = await state.approve(working, working.exposureHash);
    await writeReleaseReceipt(config, { pub_note: revision.revisionHash });
    await mkdir(destination);
    await writeFile(join(destination, "old.txt"), "old");
    const input = { config, deployments, environment: "production" };
    const plan = await planDirectoryDeployment(input);
    await writeFile(join(config.site.distDir, "leak.txt"), "PRIVATE_SENTINEL_ALPHA");

    await expect(applyDirectoryDeployment(input, plan.planHash)).rejects.toMatchObject({
      code: "RELEASE_OUTPUT_CHANGED",
    });
    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old");
    await writeReleaseReceipt(config, { pub_note: revision.revisionHash });
    const blockedPlan = await planDirectoryDeployment(input);
    expect(blockedPlan.canApply).toBe(false);
    await expect(applyDirectoryDeployment(input, blockedPlan.planHash)).rejects.toMatchObject({
      code: "DEPLOYMENT_AUDIT_FAILED",
    });
    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old");
    expect(await readFile(join(config.publisher.stateDir, "state.json"), "utf8")).not.toContain(
      "lastDeployedRevision",
    );
  });

  it("rejects symlinks in the deployment source", async () => {
    const { config, deployments, root } = fixture;
    await symlink(join(root, "outside"), join(config.site.distDir, "linked"));
    await expect(
      planDirectoryDeployment({ config, deployments, environment: "production" }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_SYMLINK" });
  });

  it("rejects a built release when active revisions changed afterward", async () => {
    const { config, deployments } = fixture;
    const state = await PublisherState.open(config.publisher.stateDir);
    const firstWorking = deploymentPublication();
    const first = await state.approve(firstWorking, firstWorking.exposureHash);
    await writeReleaseReceipt(config, { pub_note: first.revisionHash });
    const secondWorking = deploymentPublication({
      markdown: "Second",
      html: "<p>Second</p>",
      exposureHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    await state.approve(secondWorking, secondWorking.exposureHash);

    await expect(
      planDirectoryDeployment({ config, deployments, environment: "production" }),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_CHANGED" });
  });

  it("audits against one immutable policy snapshot even when live staging changes", async () => {
    const { config, deployments } = fixture;
    let snapshotObserved = false;
    const input = {
      config,
      deployments,
      environment: "production",
      afterEvidenceSnapshot: async () => {
        snapshotObserved = true;
        await writeFile(
          join(config.publisher.releaseStagingDir, "publication-manifest.json"),
          JSON.stringify({ schemaVersion: 1, pages: [{ id: "new-live-policy" }] }),
        );
      },
    };

    const plan = await planDirectoryDeployment(input);

    expect(snapshotObserved).toBe(true);
    expect(plan.canApply).toBe(true);
  });
});
