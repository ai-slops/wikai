import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { createServiceFixture } from "../../packages/service/test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;
let publicId: string;
const source =
  "---\nid: prv_source\n---\nPRIVATE BEFORE\n\n## Share\nOriginal public body.\n\n## Private\nPRIVATE AFTER\n";
const PlanSchema = z.object({
  expectedHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  projectionBody: z.string(),
  sourceBody: z.string().nullable(),
  canApply: z.boolean(),
});

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
  await writeFile(join(vault, "source.md"), source);
  const extracted = cli(
    "extract",
    "source.md",
    "--heading",
    "Share",
    "--kind",
    "log",
    "--to",
    "public-views/excerpt.md",
    "--yes",
  );
  expect(extracted.status, extracted.stderr).toBe(0);
  ({ publicId } = z.object({ publicId: z.string() }).parse(JSON.parse(extracted.stdout)));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, ...args],
    { encoding: "utf8", timeout: 15_000 },
  );
}

it("plans read-only and applies only a confirmed hash-bound body file", async () => {
  const projectionPath = join(vault, "public-views/excerpt.md");
  const originalProjection = await readFile(projectionPath, "utf8");
  await writeFile(
    join(vault, "source.md"),
    source.replace("Original public body.", "New source wording."),
  );

  const planned = cli("source-update", "plan", publicId, "--source-id", "prv_source", "--json");
  expect(planned.status, planned.stderr).toBe(0);
  const plan = PlanSchema.parse(JSON.parse(planned.stdout));
  expect(plan).toMatchObject({ canApply: true, sourceBody: "## Share\nNew source wording." });
  expect(await readFile(projectionPath, "utf8")).toBe(originalProjection);

  const bodyFile = join(root, "reviewed-merge.md");
  const mergedBody = "# Manually merged\n\nChosen wording.\n";
  await writeFile(bodyFile, mergedBody);
  const unconfirmed = cli(
    "source-update",
    "apply",
    publicId,
    "--source-id",
    "prv_source",
    "--body-file",
    bodyFile,
    "--expected-hash",
    plan.expectedHash,
  );
  expect(unconfirmed.status).toBe(2);
  expect(unconfirmed.stderr).toContain("CONFIRMATION_REQUIRED");
  expect(await readFile(projectionPath, "utf8")).toBe(originalProjection);

  const applied = cli(
    "source-update",
    "apply",
    publicId,
    "--source-id",
    "prv_source",
    "--body-file",
    bodyFile,
    "--expected-hash",
    plan.expectedHash,
    "--yes",
  );
  expect(applied.status, applied.stderr).toBe(0);
  expect(JSON.parse(applied.stdout)).toMatchObject({ publicId, path: "public-views/excerpt.md" });
  expect((await readFile(projectionPath, "utf8")).endsWith(mergedBody)).toBe(true);
});

it("rejects an apply when the selected source changed after planning", async () => {
  const projectionPath = join(vault, "public-views/excerpt.md");
  const originalProjection = await readFile(projectionPath, "utf8");
  const planned = cli(
    "source-update",
    "plan",
    publicId,
    "--source-id",
    "prv_source",
    "--reference-index",
    "0",
    "--heading",
    "Share",
    "--json",
  );
  expect(planned.status, planned.stderr).toBe(0);
  const plan = PlanSchema.parse(JSON.parse(planned.stdout));
  await writeFile(
    join(vault, "source.md"),
    source.replace("Original public body.", "Concurrent edit."),
  );
  const bodyFile = join(root, "stale-merge.md");
  await writeFile(bodyFile, "Do not overwrite\n");

  const applied = cli(
    "source-update",
    "apply",
    publicId,
    "--source-id",
    "prv_source",
    "--reference-index",
    "0",
    "--heading",
    "Share",
    "--body-file",
    bodyFile,
    "--expected-hash",
    plan.expectedHash,
    "--yes",
  );
  expect(applied.status).toBe(1);
  expect(applied.stderr).toContain("STALE_SOURCE_UPDATE");
  expect(await readFile(projectionPath, "utf8")).toBe(originalProjection);
});

it("requires both a reviewed body file and expected hash before apply", async () => {
  const missingBody = cli(
    "source-update",
    "apply",
    publicId,
    "--source-id",
    "prv_source",
    "--expected-hash",
    `sha256:${"0".repeat(64)}`,
    "--yes",
  );
  expect(missingBody.status).not.toBe(0);
  expect(missingBody.stderr).toContain("--body-file");

  const bodyFile = join(root, "reviewed-merge.md");
  await writeFile(bodyFile, "Reviewed body\n");
  const missingHash = cli(
    "source-update",
    "apply",
    publicId,
    "--source-id",
    "prv_source",
    "--body-file",
    bodyFile,
    "--yes",
  );
  expect(missingHash.status).not.toBe(0);
  expect(missingHash.stderr).toContain("--expected-hash");
});
