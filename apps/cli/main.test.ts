import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("prints help successfully without opening a vault", () => {
  const result = spawnSync(process.execPath, [resolve("apps/cli/main.ts"), "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("wiki-pub");
});

it("exposes source updates and registered operation commands through executable help", () => {
  const help = (command: readonly string[]) =>
    spawnSync(process.execPath, [resolve("apps/cli/main.ts"), ...command, "--help"], {
      encoding: "utf8",
    });

  const root = help([]);
  expect(root.status, root.stderr).toBe(0);
  expect(root.stdout).toContain("source-update");
  expect(root.stdout).toContain("deploy");

  const state = help(["state"]);
  expect(state.status, state.stderr).toBe(0);
  expect(state.stdout).toContain("release-slug");
  expect(state.stdout).toContain("gc");

  const deploy = help(["deploy"]);
  expect(deploy.status, deploy.stderr).toBe(0);
  expect(deploy.stdout).toContain("directory");
  expect(deploy.stdout).toContain("rollback");

  const sourceUpdate = help(["source-update"]);
  expect(sourceUpdate.status, sourceUpdate.stderr).toBe(0);
  expect(sourceUpdate.stdout).toContain("plan");
  expect(sourceUpdate.stdout).toContain("apply");

  const plan = help(["source-update", "plan"]);
  expect(plan.status, plan.stderr).toBe(0);
  for (const option of ["--source-id", "--reference-index", "--heading", "--block", "--lines"]) {
    expect(plan.stdout).toContain(option);
  }

  const apply = help(["source-update", "apply"]);
  expect(apply.status, apply.stderr).toBe(0);
  for (const option of [
    "--source-id",
    "--reference-index",
    "--heading",
    "--block",
    "--lines",
    "--body-file",
    "--expected-hash",
    "--yes",
  ]) {
    expect(apply.stdout).toContain(option);
  }
});

it("rejects an unknown command with a nonzero exit", () => {
  const result = spawnSync(process.execPath, [resolve("apps/cli/main.ts"), "not-a-command"], {
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("CLI_USAGE");
});

it.each(["project", "extract"])("documents the canonical --to option for %s", (command) => {
  const result = spawnSync(process.execPath, [resolve("apps/cli/main.ts"), command, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("--to <path>");
});
