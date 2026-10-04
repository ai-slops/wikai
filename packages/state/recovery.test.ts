import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash, withLock } from "../fs/index.ts";
import type { ApprovedRevision } from "../model/index.ts";
import { PublisherState } from "./index.ts";
import { applyStateMaintenance, planStateMaintenance } from "./maintenance.ts";
import { workingPublication } from "./test-fixture.ts";

let root: string;
let original: Buffer;
let revision: ApprovedRevision;
let bindingsPath: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-recovery-"));
  const state = await PublisherState.open(root);
  const working = workingPublication();
  revision = await state.approve(working, working.exposureHash);
  original = await readFile(join(root, "state.json"));
  bindingsPath = join(root, "bindings.json");
  await writeFile(
    bindingsPath,
    JSON.stringify({
      pub_note: { sourceId: "prv_note", sourcePath: "note.md", sourceMode: "mirror" },
    }),
  );
  await rm(join(root, "state.json"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("reports intact evidence without guessing missing private ownership or writing files", async () => {
  const before = await readdir(root);
  const plan = await planStateMaintenance({ mode: "recover", stateDir: root });
  expect(plan.canApply).toBe(false);
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ code: "STATE_BINDING_REQUIRED" }),
  );
  expect(plan.revisions).toMatchObject([
    { publicId: "pub_note", revisionHash: revision.revisionHash },
  ]);
  expect(JSON.stringify(plan)).not.toContain("Public content.");
  expect(await readdir(root)).toEqual(before);
});

it("recovers only inactive history and reservations, requiring a separate explicit restore", async () => {
  const request = { mode: "recover", stateDir: root, bindingsPath } as const;
  const plan = await planStateMaintenance(request);
  expect(plan.canApply).toBe(true);
  expect((await planStateMaintenance(request)).planHash).toBe(plan.planHash);

  await applyStateMaintenance(request, plan.planHash);

  const state = await PublisherState.open(root);
  expect(await state.snapshot()).toEqual({ approved: [], redirects: [] });
  expect(await state.history("pub_note")).toEqual([revision]);
  const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
  expect(stored.publications.pub_note.revisionSourceHashes[revision.revisionHash]).toBeNull();
  expect(stored.publications.pub_note.revisionSources[revision.revisionHash]).toBeNull();
  const other = workingPublication({ publicId: "pub_other", sourceId: "prv_other" });
  other.metadata = { ...other.metadata, id: "pub_other", slug: "/KNOWLEDGE/OLD-NOTE", aliases: [] };
  await expect(state.approve(other, other.exposureHash)).rejects.toMatchObject({
    code: "SLUG_COLLISION",
  });
  await state.restore("pub_note", revision.revisionHash, revision.exposureHash);
  expect(await state.approvedSourceHash("pub_note")).toBeNull();
  expect(await state.approvedSources("pub_note")).toBeNull();
});

it("uses validated backup ownership and keeps extra reservations without reactivating redirects", async () => {
  const backupPath = join(root, "backup.json");
  const backup = JSON.parse(original.toString("utf8"));
  backup.schemaVersion = 1;
  backup.publications.pub_note.reservedSlugs.push("/reserved-only-in-backup");
  backup.publications.pub_note.withdrawalFrom = "/knowledge/note";
  backup.publications.pub_note.withdrawalRedirect = "/replacement";
  await writeFile(backupPath, JSON.stringify(backup));
  const request = { mode: "recover", stateDir: root, backupPath } as const;
  const plan = await planStateMaintenance(request);
  expect(plan.canApply).toBe(true);
  await applyStateMaintenance(request, plan.planHash);
  const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
  expect(stored.publications.pub_note.reservedSlugs).toContain("/reserved-only-in-backup");
  expect(stored.publications.pub_note.revisionSourceHashes[revision.revisionHash]).toBe(
    hash("private source"),
  );
  expect(await (await PublisherState.open(root)).snapshot()).toEqual({
    approved: [],
    redirects: [],
  });
});

it("backs up exact corrupt bytes before replacing state", async () => {
  const corrupt = Buffer.from([0xff, 0xfe, 0x7b]);
  await writeFile(join(root, "state.json"), corrupt);
  const request = { mode: "recover", stateDir: root, bindingsPath } as const;
  const plan = await planStateMaintenance(request);
  const applied = await applyStateMaintenance(request, plan.planHash);
  expect(applied.backupPath).not.toBeNull();
  if (applied.backupPath === null) throw new TypeError("Missing backup");
  expect(await readFile(applied.backupPath)).toEqual(corrupt);
  await expect((await PublisherState.open(root)).snapshot()).resolves.toEqual({
    approved: [],
    redirects: [],
  });
});

it.each(["state", "bindings", "revision"])(
  "rejects a stale plan when %s changes",
  async (surface) => {
    const request = { mode: "recover", stateDir: root, bindingsPath } as const;
    const plan = await planStateMaintenance(request);
    if (surface === "state") await writeFile(join(root, "state.json"), "new concurrent state");
    if (surface === "bindings")
      await writeFile(bindingsPath, `${await readFile(bindingsPath, "utf8")}\n`);
    if (surface === "revision") {
      const path = join(root, "revisions/pub_note", `${revision.revisionHash}.json`);
      await writeFile(path, `${await readFile(path, "utf8")}\n`);
    }
    await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
      code: "STALE_STATE_PLAN",
    });
  },
);

it("refuses recovery of valid or future-version state", async () => {
  for (const raw of [original, Buffer.from('{"schemaVersion":99,"publications":{}}')]) {
    await writeFile(join(root, "state.json"), raw);
    const request = { mode: "recover", stateDir: root, bindingsPath } as const;
    const plan = await planStateMaintenance(request);
    expect(plan.canApply).toBe(false);
    await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
      code: "STATE_MAINTENANCE_BLOCKED",
    });
    expect(await readFile(join(root, "state.json"))).toEqual(raw);
  }
});

it("uses the normal exclusive publication lock for recovery", async () => {
  const request = { mode: "recover", stateDir: root, bindingsPath } as const;
  const plan = await planStateMaintenance(request);
  await withLock(root, async () => {
    await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
      code: "PUBLICATION_LOCKED",
    });
  });
});
