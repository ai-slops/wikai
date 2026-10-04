import type { Command } from "commander";
import { loadConfig } from "../../packages/config/index.ts";
import {
  applyDirectoryDeployment,
  applyDirectoryRollback,
  type DirectoryDeploymentInput,
  planDirectoryDeployment,
  planDirectoryRollback,
} from "../../packages/deploy/index.ts";
import { PublisherError } from "../../packages/model/index.ts";
import {
  applyRevisionGc,
  applySlugRelease,
  planRevisionGc,
  planSlugRelease,
} from "../../packages/state/operations.ts";
import { loadVault } from "../../packages/vault/index.ts";
import { confirmed, output } from "./helpers.ts";

type PlanOptions = {
  readonly apply?: boolean;
  readonly dryRun?: boolean;
  readonly expectedHash?: string;
  readonly yes?: boolean;
  readonly json?: boolean;
};

type GcOptions = PlanOptions & { readonly history: number };

export type OperationsDependencies = {
  readonly resolveStateDir?: (program: Command) => Promise<string>;
  readonly resolveDeploymentInput?: (
    program: Command,
    environment: string,
  ) => Promise<DirectoryDeploymentInput>;
};

function child(program: Command, name: string, description: string): Command {
  const existing = program.commands.find((command) => command.name() === name);
  return existing ?? program.command(name).description(description);
}

function planOptions(command: Command): Command {
  return command
    .option("--dry-run", "inspect only (default)")
    .option("--apply", "apply the reviewed plan")
    .option("--expected-hash <hash>", "required plan hash when applying")
    .option("--yes", "confirm mutation")
    .option("--json", "emit JSON");
}

async function assertApplyOptions(options: PlanOptions): Promise<void> {
  if (options.apply && options.dryRun) {
    throw new PublisherError("OPERATION_MODE_CONFLICT", "Choose either --apply or --dry-run");
  }
  if (options.apply && options.expectedHash === undefined) {
    throw new PublisherError(
      "EXPECTED_HASH_REQUIRED",
      "Applying an operation requires --expected-hash from a reviewed plan",
    );
  }
  if (options.apply) await confirmed(options.yes);
}

async function defaultStateDir(program: Command): Promise<string> {
  return (await loadConfig(program.optsWithGlobals<{ config?: string }>().config)).publisher
    .stateDir;
}

async function defaultDeploymentInput(
  program: Command,
  environment: string,
): Promise<DirectoryDeploymentInput> {
  const config = await loadConfig(program.optsWithGlobals<{ config?: string }>().config);
  const deployment = config.deployments?.[environment];
  if (deployment === undefined) {
    throw new PublisherError(
      "DEPLOYMENT_NOT_CONFIGURED",
      "Deployment requires an explicitly configured environment",
    );
  }
  return {
    config,
    deployments: { [environment]: deployment },
    environment,
    vault: await loadVault(config),
  };
}

export function registerOperations(
  program: Command,
  dependencies: OperationsDependencies = {},
): void {
  const resolveStateDir = dependencies.resolveStateDir ?? defaultStateDir;
  const resolveDeploymentInput = dependencies.resolveDeploymentInput ?? defaultDeploymentInput;
  const state = child(program, "state", "Manage private publication state");
  planOptions(
    state
      .command("release-slug")
      .description("Plan or apply release of an inactive URL reservation")
      .argument("<public-id>", "reservation owner")
      .argument("<slug>", "reserved canonical public path"),
  ).action(async (publicId: string, slug: string, options: PlanOptions) => {
    await assertApplyOptions(options);
    const input = { stateDir: await resolveStateDir(program), publicId, slug };
    if (options.apply && options.expectedHash !== undefined) {
      output(await applySlugRelease(input, options.expectedHash), options.json);
      return;
    }
    output(await planSlugRelease(input), options.json);
  });

  planOptions(
    state
      .command("gc")
      .description("Plan or apply immutable revision garbage collection")
      .option(
        "--history <count>",
        "additional revisions to retain per publication",
        (value) => Number(value),
        0,
      ),
  ).action(async (options: GcOptions) => {
    await assertApplyOptions(options);
    const input = {
      stateDir: await resolveStateDir(program),
      retainHistory: options.history,
    };
    if (options.apply && options.expectedHash !== undefined) {
      output(await applyRevisionGc(input, options.expectedHash), options.json);
      return;
    }
    output(await planRevisionGc(input), options.json);
  });

  const deploy = child(program, "deploy", "Manage explicitly configured local deployments");
  planOptions(
    deploy
      .command("directory")
      .description("Plan or apply an audited local directory deployment")
      .argument("<environment>", "configured deployment environment"),
  ).action(async (environment: string, options: PlanOptions) => {
    await assertApplyOptions(options);
    const input = await resolveDeploymentInput(program, environment);
    if (options.apply && options.expectedHash !== undefined) {
      output(await applyDirectoryDeployment(input, options.expectedHash), options.json);
      return;
    }
    output(await planDirectoryDeployment(input), options.json);
  });

  planOptions(
    deploy
      .command("rollback")
      .description("Plan or apply rollback to the retained previous directory")
      .argument("<environment>", "configured deployment environment"),
  ).action(async (environment: string, options: PlanOptions) => {
    await assertApplyOptions(options);
    const input = await resolveDeploymentInput(program, environment);
    if (options.apply && options.expectedHash !== undefined) {
      output(await applyDirectoryRollback(input, options.expectedHash), options.json);
      return;
    }
    output(await planDirectoryRollback(input), options.json);
  });
}
