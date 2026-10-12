import { Command } from "commander";
import type { PublicKind } from "../../packages/model/index.ts";
import { PublisherError } from "../../packages/model/index.ts";
import { registerComponentCommands } from "./components.ts";
import { confirmed, output, publisherFor } from "./helpers.ts";
import { registerOperations } from "./operations.ts";
import { registerReadCommands } from "./read-commands.ts";
import { registerSourceUpdate } from "./source-update.ts";
import { registerStateCommands } from "./state-commands.ts";
import { registerTagCommands } from "./tags.ts";

type MutationOptions = { readonly yes?: boolean; readonly expectedHash?: string };
type ApprovalOptions = MutationOptions & { readonly expectedHash: string };
type ProjectionOptions = MutationOptions & { readonly kind: PublicKind; readonly to?: string };
type ExtractOptions = ProjectionOptions & {
  readonly heading?: string;
  readonly block?: string;
  readonly lines?: string;
};

export function createProgram(): Command {
  const program = new Command()
    .name("wiki-pub")
    .description("Publish approved private-wiki revisions")
    .option("--config <path>", "publisher configuration path")
    .showSuggestionAfterError()
    .exitOverride();
  registerReadCommands(program);
  registerComponentCommands(program);
  registerStateCommands(program);
  registerOperations(program);
  registerSourceUpdate(program);
  registerTagCommands(program);
  program
    .command("candidate")
    .argument("<path>")
    .requiredOption("--kind <kind>")
    .option("--mode <mode>", "mirror or projection", "mirror")
    .option("--expected-hash <hash>")
    .option("--yes", "confirm mutation")
    .action(
      async (
        path: string,
        options: MutationOptions & {
          readonly kind: PublicKind;
          readonly mode: "mirror" | "projection";
        },
      ) => {
        await confirmed(options.yes);
        output(
          await (await publisherFor(program)).candidate({
            path,
            kind: options.kind,
            mode: options.mode,
            ...(options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash }),
          }),
        );
      },
    );
  program
    .command("project")
    .argument("<path>")
    .argument("[destination]")
    .option("--to <path>", "projection destination")
    .requiredOption("--kind <kind>")
    .option("--expected-hash <hash>")
    .option("--yes", "confirm mutation")
    .action(async (path: string, destination: string | undefined, options: ProjectionOptions) => {
      const to = options.to ?? destination;
      if (!to)
        throw new PublisherError(
          "DESTINATION_REQUIRED",
          "Specify --to for the projection destination",
        );
      await confirmed(options.yes);
      output(
        await (await publisherFor(program)).project({
          path,
          to,
          kind: options.kind,
          ...(options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash }),
        }),
      );
    });
  program
    .command("extract")
    .argument("<path>")
    .argument("[destination]")
    .option("--to <path>", "projection destination")
    .requiredOption("--kind <kind>")
    .option("--heading <heading>")
    .option("--block <block>")
    .option("--lines <start:end>")
    .option("--expected-hash <hash>")
    .option("--yes", "confirm mutation")
    .action(async (path: string, destination: string | undefined, options: ExtractOptions) => {
      const to = options.to ?? destination;
      if (!to)
        throw new PublisherError(
          "DESTINATION_REQUIRED",
          "Specify --to for the extraction destination",
        );
      await confirmed(options.yes);
      output(
        await (await publisherFor(program)).extract({
          path,
          to,
          kind: options.kind,
          ...(options.heading === undefined ? {} : { heading: options.heading }),
          ...(options.block === undefined ? {} : { block: options.block }),
          ...(options.lines === undefined ? {} : { lines: options.lines }),
          ...(options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash }),
        }),
      );
    });
  program
    .command("approve")
    .argument("<public-id>")
    .requiredOption("--expected-hash <hash>")
    .option("--yes", "confirm mutation")
    .action(async (id: string, options: ApprovalOptions) => {
      await confirmed(options.yes);
      output(await (await publisherFor(program)).approve(id, options.expectedHash));
    });
  program
    .command("withdraw")
    .argument("<public-id>")
    .requiredOption("--expected-hash <hash>")
    .option("--redirect <path>")
    .option("--yes", "confirm mutation")
    .action(async (id: string, options: ApprovalOptions & { readonly redirect?: string }) => {
      await confirmed(options.yes);
      await (await publisherFor(program)).withdraw(id, options.expectedHash, options.redirect);
      output({ publicId: id, withdrawn: true });
    });
  program
    .command("restore")
    .argument("<public-id>")
    .argument("<revision-hash>")
    .requiredOption("--expected-hash <hash>")
    .option("--yes", "confirm mutation")
    .action(async (id: string, revision: string, options: ApprovalOptions) => {
      await confirmed(options.yes);
      output(await (await publisherFor(program)).restore(id, revision, options.expectedHash));
    });
  program
    .command("build")
    .requiredOption("--release", "build approved release")
    .option("--yes", "confirm mutation")
    .action(async (options: MutationOptions) => {
      await confirmed(options.yes);
      output(await (await publisherFor(program)).build());
    });
  return program;
}
