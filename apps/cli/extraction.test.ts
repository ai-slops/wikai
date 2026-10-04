import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { RevisionSchema, WorkingSchema } from "../../packages/model/index.ts";
import { StatusSchema } from "../../packages/service/schema.ts";
import { createServiceFixture } from "../../packages/service/test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;
const source =
  "---\nid: prv_daily\n---\n## Share\nOriginal public text.\n\n## Private\nUnrelated.\n";

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
  await writeFile(join(vault, "daily.md"), source);
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

it("surfaces candidate drift through status and diff while approval preserves the copied public body", async () => {
  const extracted = cli(
    "extract",
    "daily.md",
    "--heading",
    "Share",
    "--kind",
    "log",
    "--to",
    "public-views/share.md",
    "--yes",
  );
  expect(extracted.status, extracted.stderr).toBe(0);
  const { publicId } = z.object({ publicId: z.string() }).parse(JSON.parse(extracted.stdout));
  const originalProjection = await readFile(join(vault, "public-views/share.md"), "utf8");
  const working = cli("preview", "--working", "--public-id", publicId, "--json");
  expect(working.status, working.stderr).toBe(0);
  const { publications } = z
    .object({ publications: WorkingSchema.array() })
    .parse(JSON.parse(working.stdout));
  const publication = publications[0];
  if (publication === undefined) throw new TypeError("Missing CLI preview");

  await writeFile(
    join(vault, "daily.md"),
    source.replace("Original public text.", "Changed source."),
  );
  const status = cli("status", "--json");
  expect(status.status, status.stderr).toBe(0);
  expect(StatusSchema.parse(JSON.parse(status.stdout)).publications).toContainEqual(
    expect.objectContaining({ publicId, status: "candidate", sourceDrift: true }),
  );
  const diff = cli("diff", publicId, "--format", "json");
  expect(diff.status, diff.stderr).toBe(0);
  expect(JSON.parse(diff.stdout)).toMatchObject({ sourceDrift: true });
  expect(await readFile(join(vault, "public-views/share.md"), "utf8")).toBe(originalProjection);

  const approved = cli("approve", publicId, "--expected-hash", publication.exposureHash, "--yes");
  expect(approved.status, approved.stderr).toBe(0);
  const preview = cli("preview", "--approved", "--public-id", publicId, "--json");
  expect(preview.status, preview.stderr).toBe(0);
  const revisions = z
    .object({ publications: RevisionSchema.array() })
    .parse(JSON.parse(preview.stdout));
  expect(revisions.publications[0]?.markdown).toContain("Original public text.");
  expect(revisions.publications[0]?.markdown).not.toContain("Changed source.");

  await writeFile(
    join(vault, "daily.md"),
    source
      .replace("Original public text.", "Changed source.")
      .replace("Unrelated.", "Private edit."),
  );
  const unchanged = cli("status", "--json");
  expect(unchanged.status, unchanged.stderr).toBe(0);
  expect(StatusSchema.parse(JSON.parse(unchanged.stdout)).publications).toContainEqual(
    expect.objectContaining({ publicId, status: "published", sourceDrift: false }),
  );
});

it("fails ambiguous extraction through the CLI without creating a projection", async () => {
  await writeFile(join(vault, "daily.md"), `${source}\n## Share\nAnother section.\n`);
  const result = cli(
    "extract",
    "daily.md",
    "--heading",
    "Share",
    "--kind",
    "log",
    "--to",
    "public-views/ambiguous.md",
    "--yes",
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("EXTRACT_HEADING_AMBIGUOUS");
  await expect(readFile(join(vault, "public-views/ambiguous.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
