import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { createServiceFixture } from "../../packages/service/test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;

const source = `---
id: prv_cli_tags
title: CLI tags
public:
  id: pub_cli_tags
  status: review
  mode: mirror
  kind: knowledge
  slug: /knowledge/cli-tags
  summary: CLI tag workflow
  tags:
    - Engineering/Web/React
    - Status/Stable
  knowledge:
    documentType: topic
---
# CLI tags
`;

function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, ...args],
    { encoding: "utf8", timeout: 15_000 },
  );
}

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
  await writeFile(join(vault, "tags.md"), source);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("lists, filters, plans, and applies hierarchical tags through the executable CLI", async () => {
  // Given one current publication, when read commands run, then hierarchy and subtree filtering work.
  const list = cli("tags", "list", "--json");
  expect(list.status, list.stderr).toBe(0);
  expect(JSON.parse(list.stdout)).toContainEqual(
    expect.objectContaining({ path: "Engineering/Web", descendantCount: 1 }),
  );
  const filtered = cli("tags", "filter", "Engineering", "Status/Stable", "--subtree", "--json");
  expect(filtered.status, filtered.stderr).toBe(0);
  expect(JSON.parse(filtered.stdout)).toMatchObject([{ publicId: "pub_cli_tags" }]);

  // When a rename is planned, then it is read-only and applying requires confirmation.
  const planned = cli(
    "tags",
    "rename",
    "plan",
    "Engineering/Web",
    "Technology/Web",
    "--subtree",
    "--json",
  );
  expect(planned.status, planned.stderr).toBe(0);
  const plan = z
    .object({ expectedHash: z.string(), changes: z.array(z.object({ sourceHash: z.string() })) })
    .parse(JSON.parse(planned.stdout));
  expect(await readFile(join(vault, "tags.md"), "utf8")).toBe(source);
  const unconfirmed = cli(
    "tags",
    "rename",
    "apply",
    "Engineering/Web",
    "Technology/Web",
    "--subtree",
    "--expected-hash",
    plan.expectedHash,
  );
  expect(unconfirmed.status).toBe(2);
  expect(unconfirmed.stderr).toContain("CONFIRMATION_REQUIRED");

  // When the reviewed hash is confirmed, then only the requested subtree changes.
  const applied = cli(
    "tags",
    "rename",
    "apply",
    "Engineering/Web",
    "Technology/Web",
    "--subtree",
    "--expected-hash",
    plan.expectedHash,
    "--yes",
    "--json",
  );
  expect(applied.status, applied.stderr).toBe(0);
  expect(JSON.parse(applied.stdout)).toMatchObject({ applied: true, updated: 1 });
  const changed = await readFile(join(vault, "tags.md"), "utf8");
  expect(changed).toContain("Technology/Web/React");
  expect(changed).toContain("Status/Stable");
});
