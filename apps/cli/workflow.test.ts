import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { hash } from "../../packages/fs/index.ts";
import { knowledgeSource } from "../../packages/service/test-fixture.ts";

let root: string;
let config: string;
const source = "# Public draft\n\nA deliberately selected note.\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-cli-"));
  await mkdir(join(root, "vault"));
  await writeFile(join(root, "vault", "note.md"), source);
  config = join(root, "config.yaml");
  await writeFile(
    config,
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
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(process.execPath, [resolve("apps/cli/main.ts"), "--config", config, ...args], {
    encoding: "utf8",
  });
}

it("emits a parseable JSON status through the executable", () => {
  const result = cli("status", "--json");
  expect(result.status).toBe(0);
  const output: unknown = JSON.parse(result.stdout);
  expect(output).toMatchObject({ publications: [], diagnostics: [] });
  expect(result.stderr).toBe("");
});

it("emits the additive structured change contract through plan JSON without writing state", async () => {
  // Given an authored proposal and no approval or successful-build evidence.
  await writeFile(
    join(root, "vault", "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      slug: "/knowledge/note",
      body: "Public proposal.\n",
    }),
  );

  // When plan JSON is requested through the executable.
  const result = cli("plan", "--json");

  // Then legacy keys and deterministic change data are present, and the read creates no state.
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    publications: expect.any(Array),
    diagnostics: expect.any(Array),
    approved: [],
    redirects: [],
    changes: {
      proposals: {
        baseline: "active-approved",
        summary: { added: 1, updated: 0, unchanged: 0, blocked: 0, orphaned: 0 },
      },
      release: {
        baseline: "last-successful-build",
        available: false,
        reason: "missing-receipt",
      },
    },
  });
  await expect(readFile(join(root, "vault", ".publisher", "state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("renders a concise readable plan by default", async () => {
  // Given one public proposal.
  await writeFile(
    join(root, "vault", "note.md"),
    knowledgeSource({
      privateId: "prv_note",
      publicId: "pub_note",
      title: "Note",
      slug: "/knowledge/note",
      body: "Public proposal.\n",
    }),
  );

  // When plan is requested without JSON mode.
  const result = cli("plan");

  // Then the baseline, summary, proposal status, and unavailable release evidence are readable.
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Proposals vs active-approved");
  expect(result.stdout).toContain("added=1 updated=0 unchanged=0 blocked=0 orphaned=0");
  expect(result.stdout).toContain("ADDED pub_note");
  expect(result.stdout).toContain(
    "Release vs last-successful-build: unavailable (missing-receipt)",
  );
});

it("refuses a noninteractive source mutation without --yes", async () => {
  const result = cli("candidate", "note.md", "--kind", "page");
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("CONFIRMATION_REQUIRED");
  expect(await readFile(join(root, "vault", "note.md"), "utf8")).toBe(source);
});

it("creates a candidate when the expected source hash matches", async () => {
  const result = cli(
    "candidate",
    "note.md",
    "--kind",
    "page",
    "--expected-hash",
    hash(source),
    "--yes",
  );
  expect(result.status).toBe(0);
  const response: unknown = JSON.parse(result.stdout);
  expect(response).toMatchObject({
    publicId: expect.stringMatching(/^pub_/),
    path: "note.md",
    sourceHash: expect.stringMatching(/^sha256:/),
  });
  const status = cli("status", "--json");
  expect(JSON.parse(status.stdout)).toMatchObject({
    publications: [expect.objectContaining({ status: "candidate", kind: "page" })],
  });
  expect(await readFile(join(root, "vault", "note.md"), "utf8")).toContain(
    "A deliberately selected note.",
  );
});

it("rejects a stale source hash without overwriting newer content", async () => {
  await writeFile(join(root, "vault", "note.md"), "# Newer draft\n");
  const result = cli(
    "candidate",
    "note.md",
    "--kind",
    "page",
    "--expected-hash",
    hash(source),
    "--yes",
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("CONCURRENT_SOURCE_MODIFICATION");
  expect(await readFile(join(root, "vault", "note.md"), "utf8")).toBe("# Newer draft\n");
});

it("exits unsuccessfully when a distribution audit fails", () => {
  const result = cli("audit", join(root, "missing-dist"), "--json");
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toContainEqual(
    expect.objectContaining({ code: "AUDIT_DIST_MISSING", severity: "error" }),
  );
});
