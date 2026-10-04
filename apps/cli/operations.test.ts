import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublisherError } from "../../packages/model/index.ts";
import { PublisherState } from "../../packages/state/index.ts";
import { planSlugRelease } from "../../packages/state/operations.ts";
import { workingPublication } from "../../packages/state/test-fixture.ts";
import { type OperationsDependencies, registerOperations } from "./operations.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-cli-operations-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function program(dependencies: OperationsDependencies = {}): Command {
  const command = new Command();
  command.exitOverride();
  registerOperations(command, { resolveStateDir: async () => root, ...dependencies });
  return command;
}

it("registers isolated state and deployment operation commands", () => {
  const command = program();
  expect(command.commands.map((item) => item.name())).toEqual(["state", "deploy"]);
  expect(
    command.commands.find((item) => item.name() === "state")?.commands.map((item) => item.name()),
  ).toEqual(["release-slug", "gc"]);
  expect(
    command.commands.find((item) => item.name() === "deploy")?.commands.map((item) => item.name()),
  ).toEqual(["directory", "rollback"]);
});

it("plans by default and applies slug release only with hash and confirmation", async () => {
  const state = await PublisherState.open(root);
  const working = workingPublication();
  const revision = await state.approve(working, working.exposureHash);
  await state.withdraw(revision.publicId, revision.exposureHash);
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await program().parseAsync(
    ["state", "release-slug", revision.publicId, "/knowledge/old-note", "--json"],
    { from: "user" },
  );
  const plan = await planSlugRelease({
    stateDir: root,
    publicId: revision.publicId,
    slug: "/knowledge/old-note",
  });
  expect(output).toHaveBeenCalled();
  await program().parseAsync(
    [
      "state",
      "release-slug",
      revision.publicId,
      "/knowledge/old-note",
      "--apply",
      "--expected-hash",
      plan.planHash,
      "--yes",
      "--json",
    ],
    { from: "user" },
  );
  const stored: unknown = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
  expect(stored).toMatchObject({
    publications: { pub_note: { reservedSlugs: ["/knowledge/note"] } },
  });
});

it("defaults GC to dry-run", async () => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await program().parseAsync(["state", "gc", "--json"], { from: "user" });
  expect(output).toHaveBeenCalled();
});

it("preserves an injected deployment resolver", async () => {
  const resolveDeploymentInput = vi.fn(async () => {
    throw new PublisherError("INJECTED_DEPLOYMENT", "Injected resolver reached");
  });
  await expect(
    program({ resolveDeploymentInput }).parseAsync(
      ["deploy", "directory", "production", "--json"],
      { from: "user" },
    ),
  ).rejects.toMatchObject({ code: "INJECTED_DEPLOYMENT" });
  expect(resolveDeploymentInput).toHaveBeenCalledWith(expect.any(Command), "production");
});
