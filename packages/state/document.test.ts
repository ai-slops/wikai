import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readStateDocument } from "./document.ts";
import { PublisherState } from "./index.ts";
import { workingPublication } from "./test-fixture.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-state-document-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("refuses to treat retained revisions as a brand-new state store", async () => {
  const state = await PublisherState.open(root);
  const working = workingPublication();
  await state.approve(working, working.exposureHash);
  await rm(join(root, "state.json"));

  await expect(PublisherState.open(root)).rejects.toMatchObject({
    code: "STATE_RECOVERY_REQUIRED",
  });
});

it("detects lost state from its initialization marker even without remaining revisions", async () => {
  const state = await PublisherState.open(root);
  const working = workingPublication();
  await state.approve(working, working.exposureHash);
  await rm(join(root, "state.json"));
  await rm(join(root, "revisions"), { recursive: true });

  await expect(readStateDocument(root)).rejects.toMatchObject({ code: "STATE_RECOVERY_REQUIRED" });
});

it("allows a genuinely empty revision directory without creating a state file", async () => {
  await mkdir(join(root, "revisions"));
  expect((await readStateDocument(root)).publications).toEqual({});
  await expect(readFile(join(root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["file", "symlink"])(
  "treats a %s revision root as damaged initialized storage",
  async (kind) => {
    if (kind === "file") await writeFile(join(root, "revisions"), "damaged directory");
    else {
      await mkdir(join(root, "outside"));
      await symlink(join(root, "outside"), join(root, "revisions"));
    }
    await expect(readStateDocument(root)).rejects.toMatchObject({
      code: "STATE_RECOVERY_REQUIRED",
    });
  },
);

it("rejects symlinked state instead of reading through it", async () => {
  await writeFile(join(root, "other.json"), '{"schemaVersion":1,"publications":{}}');
  await symlink(join(root, "other.json"), join(root, "state.json"));
  await expect(readStateDocument(root)).rejects.toMatchObject({ code: "ASSET_SYMLINK" });
});

it("rejects an unsupported future schema rather than treating it as corrupt v1", async () => {
  await writeFile(join(root, "state.json"), '{"schemaVersion":99,"publications":{}}');
  await expect(readStateDocument(root)).rejects.toMatchObject({ code: "STATE_SCHEMA_MISMATCH" });
});

it("migrates supported v1 state in memory without changing its file", async () => {
  const original = '{"schemaVersion":1,"publications":{}}';
  await writeFile(join(root, "state.json"), original);
  expect(await readStateDocument(root)).toEqual({ schemaVersion: 2, publications: {} });
  expect(await readFile(join(root, "state.json"), "utf8")).toBe(original);
});

it("compares a mutation against the state read before its approval callback", async () => {
  const state = await PublisherState.open(root);
  const working = workingPublication();
  const concurrent = '{"schemaVersion":1,"publications":{}}';

  await expect(
    state.approve(working, working.exposureHash, async () => {
      await writeFile(join(root, "state.json"), concurrent);
      return { working, sourceHash: working.sourceHash, sources: working.sources };
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_SOURCE_MODIFICATION" });
  expect(await readFile(join(root, "state.json"), "utf8")).toBe(concurrent);
});
