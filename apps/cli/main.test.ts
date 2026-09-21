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
