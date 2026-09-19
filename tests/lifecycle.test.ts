import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { loadConfig } from "../packages/config/index.ts";
import { buildReleaseStaging } from "../packages/release/index.ts";
import { Publisher } from "../packages/service/index.ts";

const execute = promisify(execFile);
let root: string;
let configPath: string;
let sourcePath: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-lifecycle-"));
  await mkdir(join(root, "vault"));
  configPath = join(root, "config.yaml");
  sourcePath = join(root, "vault", "note.md");
  await writeFile(
    configPath,
    stringify({
      vault: { root: "vault" },
      publisher: {
        stateDir: "vault/.publisher",
        previewStagingDir: "preview",
        releaseStagingDir: "release",
      },
      site: { sourceDir: "site", distDir: "dist" },
    }),
  );
  await writeFile(
    sourcePath,
    `---\nid: prv_lifecycle\ntitle: A reviewed page\npublic:\n  id: pub_lifecycle\n  status: published\n  mode: mirror\n  kind: page\n  slug: /reviewed\n  page:\n    layout: generic\n---\n\n# Reviewed content\n\nThis sentence was approved.\n`,
  );
  await writeFile(join(root, "vault", "private.md"), "# Private\n\nPRIVATE_SENTINEL_BODY_01\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("does not release published frontmatter before explicit approval", async () => {
  const publisher = await Publisher.open(configPath);
  const plan = await publisher.plan();
  await buildReleaseStaging(plan.approved, await loadConfig(configPath), plan.redirects);
  const output = await readFile(join(root, "release", "content-index.json"), "utf8");
  expect(output).not.toContain("This sentence was approved.");
  expect(output).not.toContain("PRIVATE_SENTINEL");
});

it("uses the approved snapshot after unreviewed edits and source deletion", async () => {
  const publisher = await Publisher.open(configPath);
  const first = (await publisher.plan()).publications[0];
  if (!first) throw new Error("Fixture publication missing");
  await publisher.approve(first.publicId, first.exposureHash);
  await writeFile(
    sourcePath,
    `${await readFile(sourcePath, "utf8")}\nPRIVATE_SENTINEL_UNREVIEWED_02\n`,
  );
  await rm(sourcePath);
  const plan = await publisher.plan();
  await buildReleaseStaging(plan.approved, await loadConfig(configPath), plan.redirects);
  const output = await readFile(join(root, "release", "content-index.json"), "utf8");
  expect(output).toContain("This sentence was approved.");
  expect(output).not.toContain("PRIVATE_SENTINEL");
  expect(output).not.toContain("prv_lifecycle");
  expect(output).not.toContain("note.md");
});

it("removes withdrawn content from a clean replacement staging", async () => {
  const publisher = await Publisher.open(configPath);
  const first = (await publisher.plan()).publications[0];
  if (!first) throw new Error("Fixture publication missing");
  await publisher.approve(first.publicId, first.exposureHash);
  const active = await publisher.plan();
  await buildReleaseStaging(active.approved, await loadConfig(configPath), active.redirects);
  await publisher.withdraw(first.publicId, first.exposureHash);
  const withdrawn = await publisher.plan();
  await buildReleaseStaging(withdrawn.approved, await loadConfig(configPath), withdrawn.redirects);
  expect(await readFile(join(root, "release", "content-index.json"), "utf8")).not.toContain(
    "pub_lifecycle",
  );
});

it("runs plan through the real Node CLI with machine-readable output", async () => {
  const result = await execute(process.execPath, [
    resolve("apps/cli/main.ts"),
    "--config",
    configPath,
    "plan",
    "--json",
  ]);
  const payload: unknown = JSON.parse(result.stdout);
  expect(payload).toMatchObject({ publications: [{ publicId: "pub_lifecycle" }], approved: [] });
  expect(result.stderr).not.toContain("PRIVATE_SENTINEL");
});
