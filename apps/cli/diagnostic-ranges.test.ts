import { spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createServiceFixture } from "../../packages/service/test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("prints exact source ranges through the real validate JSON command", async () => {
  await writeFile(
    join(vault, "source.md"),
    "---\nid: prv_source\npublic:\n  id: pub_source\n  status: review\n  mode: mirror\n  kind: knowledge\n  slug: /knowledge/source\n  title: Source\n  summary: Source page\n  contentState: stable\n  knowledge:\n    documentType: topic\n---\nSee [[Missing]].\n",
  );

  const result = spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, "validate", "--json"],
    { encoding: "utf8", timeout: 15_000 },
  );

  expect(result.status).toBe(1);
  expect(result.stdout).toBe(`[
  {
    "code": "UNRESOLVED_INTERNAL_LINK",
    "severity": "error",
    "message": "Internal link target cannot be resolved",
    "sourcePath": "source.md",
    "publicId": "pub_source",
    "sourceRange": {
      "startLine": 15,
      "startColumn": 5,
      "endLine": 15,
      "endColumn": 16
    }
  }
]
`);
  expect(result.stderr).toContain("VALIDATION_FAILED");
});
