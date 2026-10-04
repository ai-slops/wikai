import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { ApprovedRevision } from "../model/index.ts";
import { PublisherState } from "./index.ts";
import { applyStateMaintenance, planStateMaintenance } from "./maintenance.ts";
import { createRevision, writeRevision } from "./revision.ts";
import { workingPublication } from "./test-fixture.ts";

let root: string;
let backupPath: string;
let revision: ApprovedRevision;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-recovery-safety-"));
  const state = await PublisherState.open(root);
  const working = workingPublication();
  revision = await state.approve(working, working.exposureHash);
  backupPath = join(root, "backup.json");
  await writeFile(backupPath, await readFile(join(root, "state.json")));
  await writeFile(join(root, "state.json"), "corrupt original");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(["tamper", "missing", "symlink", "unexpected"])(
  "blocks %s revision evidence without changing damaged state",
  async (kind) => {
    const path = join(root, "revisions/pub_note", `${revision.revisionHash}.json`);
    switch (kind) {
      case "tamper":
        await writeFile(path, "{}");
        break;
      case "missing":
        await rm(path);
        break;
      case "symlink":
        await rm(path);
        await symlink(backupPath, path);
        break;
      case "unexpected":
        await writeFile(join(root, "revisions/pub_note/unexpected.txt"), "private");
        break;
    }
    const request = { mode: "recover", stateDir: root, backupPath } as const;
    const plan = await planStateMaintenance(request);
    expect(plan.canApply).toBe(false);
    await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
      code: "STATE_MAINTENANCE_BLOCKED",
    });
    expect(await readFile(join(root, "state.json"), "utf8")).toBe("corrupt original");
  },
);

it.each(["file", "symlink"])(
  "reports an invalid %s revision root without traversing it",
  async (kind) => {
    await rm(join(root, "revisions"), { recursive: true });
    if (kind === "file") await writeFile(join(root, "revisions"), "damaged directory");
    else {
      await mkdir(join(root, "outside"));
      await symlink(join(root, "outside"), join(root, "revisions"));
    }
    const request = { mode: "recover", stateDir: root, backupPath } as const;
    const plan = await planStateMaintenance(request);
    expect(plan.canApply).toBe(false);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "STATE_REVISION_ENTRY_INVALID" }),
    );
    await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
      code: "STATE_MAINTENANCE_BLOCKED",
    });
    expect(await readFile(join(root, "state.json"), "utf8")).toBe("corrupt original");
  },
);

it.each([
  { pub_note: { sourceId: "prv_other", sourcePath: "note.md", sourceMode: "mirror" } },
  { pub_unused: { sourceId: "prv_unused", sourcePath: "unused.md", sourceMode: "mirror" } },
  { pub_note: { sourceId: "prv_note", sourcePath: "../outside.md", sourceMode: "mirror" } },
])("blocks invalid, conflicting or unused source bindings %j", async (bindings) => {
  const bindingsPath = join(root, "bindings.json");
  await writeFile(bindingsPath, JSON.stringify(bindings));
  const plan = await planStateMaintenance({
    mode: "recover",
    stateDir: root,
    backupPath,
    bindingsPath,
  });
  expect(plan.canApply).toBe(false);
});

it("does not choose an owner for colliding reconstructed URL reservations", async () => {
  const other = workingPublication({
    publicId: "pub_other",
    sourceId: "prv_other",
    exposureHash: hash("other"),
    metadata: {
      ...workingPublication().metadata,
      id: "pub_other",
      slug: "/KNOWLEDGE/NOTE",
      aliases: [],
    },
  });
  await writeRevision(root, createRevision(other, { isUpdate: false }));
  const bindingsPath = join(root, "bindings.json");
  await writeFile(
    bindingsPath,
    JSON.stringify({
      pub_other: { sourceId: "prv_other", sourcePath: "other.md", sourceMode: "mirror" },
    }),
  );
  const plan = await planStateMaintenance({
    mode: "recover",
    stateDir: root,
    backupPath,
    bindingsPath,
  });
  expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "SLUG_COLLISION" }));
  expect(plan.canApply).toBe(false);
});

it("invalidates a reviewed plan when the supplied backup changes", async () => {
  const request = { mode: "recover", stateDir: root, backupPath } as const;
  const plan = await planStateMaintenance(request);
  await writeFile(backupPath, `${await readFile(backupPath, "utf8")}\n`);
  await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
    code: "STALE_STATE_PLAN",
  });
});

it("refuses to overwrite a mismatched preexisting backup", async () => {
  const request = { mode: "recover", stateDir: root, backupPath } as const;
  const plan = await planStateMaintenance(request);
  await mkdir(join(root, "recovery-backups"));
  const backup = join(root, "recovery-backups", `${hash("corrupt original").slice(7)}.json`);
  await writeFile(backup, "do not overwrite");
  await expect(applyStateMaintenance(request, plan.planHash)).rejects.toMatchObject({
    code: "STATE_BACKUP_COLLISION",
  });
  expect(await readFile(backup, "utf8")).toBe("do not overwrite");
  expect(await readFile(join(root, "state.json"), "utf8")).toBe("corrupt original");
});

it("requires evidence instead of resetting a marker-only store to empty", async () => {
  await rm(join(root, "revisions"), { recursive: true });
  const plan = await planStateMaintenance({ mode: "recover", stateDir: root });
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ code: "STATE_RECOVERY_EMPTY" }),
  );
  expect(plan.canApply).toBe(false);
});
