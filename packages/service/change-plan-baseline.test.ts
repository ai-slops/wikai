import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { buildReleaseStaging } from "../release/index.ts";
import { redirectsPolicyHash, releasePolicyHash, revisionsForRelease } from "../release/receipt.ts";
import { PublisherState } from "../state/index.ts";
import { loadLastBuildBaseline } from "./change-plan-baseline.ts";
import { Publisher } from "./index.ts";
import { createServiceFixture, knowledgeSource } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  await writeFile(
    join(vault, "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      slug: "/knowledge/note",
      body: "Built body.\n",
    }),
  );
  publisher = await Publisher.open(fixture.configPath);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("loads exact revisions and redirects from validated last-successful-build evidence", async () => {
  // Given an approved revision, matching release staging, and a successful-build receipt.
  const working = (await publisher.plan()).publications[0];
  if (working === undefined) throw new TypeError("Missing working publication");
  const revision = await publisher.approve(working.publicId, working.exposureHash);
  const redirects = [{ from: "/knowledge/old-note", to: "/knowledge/note", status: 301 }] as const;
  await buildReleaseStaging([revision], publisher.config, redirects);
  await writeFile(
    join(publisher.config.publisher.stateDir, "release-receipt.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      revisions: revisionsForRelease([revision]),
      redirectsHash: redirectsPolicyHash(redirects),
      stagingPolicyHash: await releasePolicyHash(publisher.config.publisher.releaseStagingDir),
      distFingerprintHash: hash("built dist"),
    })}\n`,
  );

  // When the service reads the build baseline.
  const baseline = await loadLastBuildBaseline(
    publisher.config,
    await PublisherState.open(publisher.config.publisher.stateDir),
  );

  // Then it returns the exact immutable revision and redirect policy.
  expect(baseline).toEqual({ available: true, publications: [revision], redirects });
});

it("rejects a receipt whose retained staging policy changed", async () => {
  // Given a valid empty build receipt followed by modified staging policy bytes.
  await buildReleaseStaging([], publisher.config, []);
  await writeFile(
    join(publisher.config.publisher.stateDir, "release-receipt.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      revisions: {},
      redirectsHash: redirectsPolicyHash([]),
      stagingPolicyHash: await releasePolicyHash(publisher.config.publisher.releaseStagingDir),
      distFingerprintHash: hash("built dist"),
    })}\n`,
  );
  await writeFile(
    join(publisher.config.publisher.releaseStagingDir, "redirects.json"),
    `${JSON.stringify({ schemaVersion: 1, redirects: [{ from: "/changed", to: "/", status: 301 }] })}\n`,
  );

  // When the baseline is loaded, then stale staging is explicit instead of becoming history.
  await expect(
    loadLastBuildBaseline(
      publisher.config,
      await PublisherState.open(publisher.config.publisher.stateDir),
    ),
  ).resolves.toEqual({ available: false, reason: "stale-staging-policy" });
});
