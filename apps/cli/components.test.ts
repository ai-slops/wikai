import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { createServiceFixture } from "../../packages/service/test-fixture.ts";

let root: string;
let configPath: string;

beforeEach(async () => {
  ({ root, configPath } = await createServiceFixture());
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

it("executes component plan and hash-bound approval through the real CLI", () => {
  // Given an empty publication store with no implicitly eligible first-time MDX.
  const planned = cli("components", "plan", "--json");
  expect(planned.status, planned.stderr).toBe(0);
  const plan = z
    .object({ planHash: z.string(), eligible: z.array(z.unknown()), skipped: z.array(z.unknown()) })
    .parse(JSON.parse(planned.stdout));
  expect(plan.eligible).toEqual([]);

  // When the entire reviewed eligible list is approved with confirmation.
  const approved = cli(
    "components",
    "approve",
    "--expected-hash",
    plan.planHash,
    "--yes",
    "--json",
  );

  // Then the service-backed command succeeds without approving anything implicitly.
  expect(approved.status, approved.stderr).toBe(0);
  expect(JSON.parse(approved.stdout)).toMatchObject({
    applied: true,
    planHash: plan.planHash,
    approved: [],
  });
});

it("requires confirmation and rejects a stale component plan hash", () => {
  // Given the component approval command.
  const missingConfirmation = cli(
    "components",
    "approve",
    "--expected-hash",
    hashLike("confirmation"),
    "--json",
  );
  expect(missingConfirmation.status).toBe(2);
  expect(missingConfirmation.stderr).toContain("CONFIRMATION_REQUIRED");

  // When an explicitly confirmed but stale hash is supplied, then apply fails closed.
  const stale = cli(
    "components",
    "approve",
    "--expected-hash",
    hashLike("stale"),
    "--yes",
    "--json",
  );
  expect(stale.status).toBe(1);
  expect(stale.stderr).toContain("STALE_COMPONENT_PLAN");
});

function hashLike(seed: string): string {
  return `sha256:${Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}
