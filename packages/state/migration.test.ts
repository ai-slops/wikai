import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PublisherState } from "./index.ts";
import { applyStateMaintenance, planStateMaintenance } from "./maintenance.ts";
import { workingPublication } from "./test-fixture.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-migrate-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("explicitly persists v1 to v2 without changing approval, history or reservations", async () => {
  const state = await PublisherState.open(root);
  const working = workingPublication();
  const revision = await state.approve(working, working.exposureHash);
  const legacy = {
    ...JSON.parse(await readFile(join(root, "state.json"), "utf8")),
    schemaVersion: 1,
  };
  delete legacy.publications.pub_note.lastReviewedAt;
  delete legacy.publications.pub_note.lastDeployedRevision;
  const bytes = Buffer.from(JSON.stringify(legacy));
  await writeFile(join(root, "state.json"), bytes);
  const request = { mode: "migrate", stateDir: root } as const;
  const plan = await planStateMaintenance(request);
  expect(plan.sourceVersion).toBe(1);
  expect(plan.canApply).toBe(true);
  expect(await readFile(join(root, "state.json"))).toEqual(bytes);

  const result = await applyStateMaintenance(request, plan.planHash);

  expect(JSON.parse(await readFile(join(root, "state.json"), "utf8"))).toEqual({
    ...legacy,
    schemaVersion: 2,
  });
  expect(await state.approved("pub_note")).toEqual(revision);
  if (result.backupPath === null) throw new TypeError("Missing migration backup");
  expect(await readFile(result.backupPath)).toEqual(bytes);
  expect((await planStateMaintenance(request)).canApply).toBe(false);
});

it("does not use migration to reset missing or corrupt state", async () => {
  const request = { mode: "migrate", stateDir: root } as const;
  expect((await planStateMaintenance(request)).canApply).toBe(false);
  await writeFile(join(root, "state.json"), "broken");
  expect((await planStateMaintenance(request)).canApply).toBe(false);
});
