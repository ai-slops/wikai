import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { z } from "zod";
import {
  createDeploymentFixture,
  type DeploymentFixture,
} from "../../packages/deploy/test-fixture.ts";

let fixture: DeploymentFixture;
let configPath: string;

beforeEach(async () => {
  fixture = await createDeploymentFixture();
  await mkdir(fixture.config.vault.root);
  configPath = join(fixture.root, "publisher.config.yaml");
  await writeFile(
    configPath,
    stringify({
      ...fixture.config,
      vault: { ...fixture.config.vault, root: "vault" },
      publisher: {
        ...fixture.config.publisher,
        stateDir: "state",
        previewStagingDir: "preview",
        releaseStagingDir: "staging",
      },
      site: { ...fixture.config.site, sourceDir: "site", distDir: "dist" },
      deployments: { production: { type: "directory", root: "deployed" } },
    }),
  );
});

afterEach(async () => {
  await fixture.cleanup();
});

function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("apps/cli/main.ts"), "--config", configPath, ...args],
    { encoding: "utf8", timeout: 15_000 },
  );
}

it("plans registered revision garbage collection through the executable", () => {
  const result = cli("state", "gc", "--json");

  expect(result.status, result.stderr).toBe(0);
  expect(
    z
      .object({ planHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u), canApply: z.boolean() })
      .parse(JSON.parse(result.stdout)),
  ).toMatchObject({ canApply: true });
});

it("plans a configured directory deployment through the executable", () => {
  const result = cli("deploy", "directory", "production", "--json");

  expect(result.status, result.stderr).toBe(0);
  expect(
    z
      .object({
        operation: z.literal("directory-deploy"),
        environment: z.literal("production"),
        destination: z.string(),
        planHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
        canApply: z.boolean(),
      })
      .parse(JSON.parse(result.stdout)),
  ).toMatchObject({ destination: fixture.destination, canApply: true });
});

it("refuses an unconfigured deployment environment through the executable", () => {
  const result = cli("deploy", "directory", "staging", "--json");

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("DEPLOYMENT_NOT_CONFIGURED");
});
