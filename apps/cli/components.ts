import type { Command } from "commander";
import { confirmed, output, publisherFor } from "./helpers.ts";

type ReadOptions = { readonly json?: boolean };
type ApprovalOptions = ReadOptions & {
  readonly expectedHash: string;
  readonly yes?: boolean;
};

export function registerComponentCommands(program: Command): void {
  const components = program
    .command("components")
    .description("Review and approve shared-component-only publication updates");
  components
    .command("plan")
    .description("Plan component-only approvals without changing publication state")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions) => {
      output(await (await publisherFor(program)).planComponentUpdateApproval(), options.json);
    });
  components
    .command("approve")
    .description("Approve the entire reviewed component-only eligible list")
    .requiredOption("--expected-hash <hash>", "hash from the reviewed component plan")
    .option("--yes", "confirm mutation")
    .option("--json", "emit JSON")
    .action(async (options: ApprovalOptions) => {
      await confirmed(options.yes);
      output(
        await (await publisherFor(program)).applyComponentUpdateApproval(options.expectedHash),
        options.json,
      );
    });
}
