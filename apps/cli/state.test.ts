import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import type { ApprovedRevision } from "../../packages/model/index.ts";
import { Publisher } from "../../packages/service/index.ts";
import { createServiceFixture, knowledgeSource } from "../../packages/service/test-fixture.ts";

let root: string;
let configPath: string;
let bindingsPath: string;
let original: Buffer;
let revision: ApprovedRevision;
const PlanSchema = z.object({ planHash: z.string(), canApply: z.boolean() });

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, configPath } = fixture);
  await writeFile(
    join(fixture.vault, "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      slug: "/knowledge/note",
      body: "Public content.",
    }),
  );
  const publisher = await Publisher.open(configPath);
  const working = (await publisher.detail("pub_note")).working;
  if (working === null) throw new TypeError("Missing fixture publication");
  revision = await publisher.approve("pub_note", working.exposureHash);
  original = await readFile(join(root, "state/state.json"));
  bindingsPath = join(root, "bindings.json");
  await writeFile(
    bindingsPath,
    JSON.stringify({
      pub_note: {
        sourceId: "prv_note",
        sourcePath: "note.md",
        sourceMode: "mirror",
      },
    }),
  );
  await rm(join(root, "state/state.json"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, ...args],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

it("plans recovery while normal status fails closed and leaves state absent", async () => {
  const help = cli("state", "recover", "--help");
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("--bindings");
  const status = cli("status", "--json");
  expect(status.status).toBe(1);
  expect(status.stderr).toContain("STATE_RECOVERY_REQUIRED");
  const missing = cli("state", "recover", "--json");
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({ canApply: false });
  const plan = cli("state", "recover", "--bindings", bindingsPath, "--dry-run", "--json");
  expect(plan.status, plan.stderr).toBe(0);
  expect(PlanSchema.parse(JSON.parse(plan.stdout)).canApply).toBe(true);
  await expect(readFile(join(root, "state/state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("requires an explicit reviewed hash and confirmation to apply", () => {
  const plan = PlanSchema.parse(
    JSON.parse(cli("state", "recover", "--bindings", bindingsPath, "--json").stdout),
  );
  const missingHash = cli("state", "recover", "--bindings", bindingsPath, "--apply", "--yes");
  expect(missingHash.status).toBe(1);
  expect(missingHash.stderr).toContain("EXPECTED_HASH_REQUIRED");
  const unconfirmed = cli(
    "state",
    "recover",
    "--bindings",
    bindingsPath,
    "--apply",
    "--expected-hash",
    plan.planHash,
  );
  expect(unconfirmed.status).toBe(2);
  expect(unconfirmed.stderr).toContain("CONFIRMATION_REQUIRED");
});

it("recovers inactive history then permits a separately confirmed restore with unknown drift", () => {
  const plan = PlanSchema.parse(
    JSON.parse(cli("state", "recover", "--bindings", bindingsPath, "--json").stdout),
  );
  const applied = cli(
    "state",
    "recover",
    "--bindings",
    bindingsPath,
    "--apply",
    "--expected-hash",
    plan.planHash,
    "--yes",
  );
  expect(applied.status, applied.stderr).toBe(0);
  expect(JSON.parse(cli("preview", "--approved", "--json").stdout)).toMatchObject({
    publications: [],
  });
  expect(JSON.parse(cli("status", "--json").stdout)).toMatchObject({
    publications: [expect.objectContaining({ publicId: "pub_note", status: "withdrawn" })],
  });
  const restored = cli(
    "restore",
    "pub_note",
    revision.revisionHash,
    "--expected-hash",
    revision.exposureHash,
    "--yes",
  );
  expect(restored.status, restored.stderr).toBe(0);
  expect(JSON.parse(cli("diff", "pub_note", "--format", "json").stdout)).toMatchObject({
    sourceDrift: true,
  });
});

it("migrates legacy state explicitly without deactivating its approved publication", async () => {
  const legacy = Buffer.from(
    JSON.stringify({ ...JSON.parse(original.toString("utf8")), schemaVersion: 1 }),
  );
  await writeFile(join(root, "state/state.json"), legacy);
  const read = cli("state", "migrate", "--json");
  expect(read.status, read.stderr).toBe(0);
  const plan = PlanSchema.parse(JSON.parse(read.stdout));
  expect(await readFile(join(root, "state/state.json"))).toEqual(legacy);
  const applied = cli("state", "migrate", "--apply", "--expected-hash", plan.planHash, "--yes");
  expect(applied.status, applied.stderr).toBe(0);
  expect(JSON.parse(cli("preview", "--approved", "--json").stdout)).toMatchObject({
    publications: [
      expect.objectContaining({ publicId: "pub_note", revisionHash: revision.revisionHash }),
    ],
  });
});
