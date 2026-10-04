import type { Command } from "commander";
import { loadConfig } from "../../packages/config/index.ts";
import { PublisherError } from "../../packages/model/index.ts";
import { applyStateMaintenance, planStateMaintenance } from "../../packages/state/maintenance.ts";
import { confirmed, output } from "./helpers.ts";

type MaintenanceOptions = {
  readonly apply?: boolean;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly json?: boolean;
  readonly expectedHash?: string;
  readonly backup?: string;
  readonly bindings?: string;
};

export function registerStateCommands(program: Command): void {
  const state = program
    .command("state")
    .description("Inspect, migrate or recover private publication state");
  for (const mode of ["recover", "migrate"] as const) {
    const command = state
      .command(mode)
      .description(
        mode === "recover"
          ? "Plan inactive recovery from verified revisions"
          : "Plan a supported state schema upgrade",
      )
      .option("--dry-run", "inspect only (default)")
      .option("--apply", "apply the reviewed plan")
      .option("--expected-hash <hash>", "required plan hash when applying")
      .option("--yes", "confirm mutation")
      .option("--json", "emit JSON");
    if (mode === "recover") {
      command
        .option("--backup <path>", "validated private state backup")
        .option("--bindings <path>", "reviewed public-ID to private-source bindings JSON");
    }
    command.action(async (options: MaintenanceOptions) => {
      if (options.apply && options.dryRun) {
        throw new PublisherError("STATE_MODE_CONFLICT", "Choose either --apply or --dry-run");
      }
      if (options.apply && options.expectedHash === undefined) {
        throw new PublisherError(
          "EXPECTED_HASH_REQUIRED",
          "Applying state maintenance requires --expected-hash from a reviewed plan",
        );
      }
      if (options.apply) await confirmed(options.yes);
      const config = await loadConfig(program.opts<{ config?: string }>().config);
      const input = {
        mode,
        stateDir: config.publisher.stateDir,
        ...(options.backup === undefined ? {} : { backupPath: options.backup }),
        ...(options.bindings === undefined ? {} : { bindingsPath: options.bindings }),
      };
      if (options.apply && options.expectedHash !== undefined) {
        output(await applyStateMaintenance(input, options.expectedHash), options.json);
        return;
      }
      const plan = await planStateMaintenance(input);
      output(plan, options.json);
      if (plan.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new PublisherError(
          "STATE_MAINTENANCE_BLOCKED",
          "Review the state maintenance diagnostics before applying",
        );
      }
    });
  }
}
