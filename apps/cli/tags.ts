import type { Command } from "commander";
import { confirmed, output, publisherFor } from "./helpers.ts";

type ReadOptions = { readonly json?: boolean };
type MatchOptions = ReadOptions & { readonly subtree?: boolean };
type ApplyOptions = MatchOptions & {
  readonly expectedHash: string;
  readonly yes?: boolean;
};

const mode = (options: MatchOptions): "exact" | "subtree" =>
  options.subtree ? "subtree" : "exact";

function renameArguments(command: Command): Command {
  return command
    .argument("<from>", "current tag path")
    .argument("<to>", "replacement tag path")
    .option("--subtree", "rename the path and every descendant")
    .option("--json", "emit JSON");
}

export function registerTagCommands(program: Command): void {
  const tags = program.command("tags").description("Query and manage public tag paths");
  tags
    .command("list")
    .description("List direct and descendant document counts")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions) => {
      output(await (await publisherFor(program)).tagList(), options.json);
    });
  tags
    .command("tree")
    .description("Show the inferred public tag tree")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions) => {
      output(await (await publisherFor(program)).tagTree(), options.json);
    });
  tags
    .command("filter")
    .description("Find documents matching every supplied public tag")
    .argument("<tags...>", "one or more tag paths")
    .option("--subtree", "include descendants of each path")
    .option("--json", "emit JSON")
    .action(async (queries: string[], options: MatchOptions) => {
      output(
        await (await publisherFor(program)).filterByTags({ tags: queries, mode: mode(options) }),
        options.json,
      );
    });

  const rename = tags.command("rename").description("Plan or apply a public tag path rename");
  renameArguments(
    rename.command("plan").description("Preview a source-hash-bound batch rename"),
  ).action(async (from: string, to: string, options: MatchOptions) => {
    output(
      await (await publisherFor(program)).planTagRename({ from, to, mode: mode(options) }),
      options.json,
    );
  });
  renameArguments(
    rename
      .command("apply")
      .description("Apply a reviewed tag rename plan")
      .requiredOption("--expected-hash <hash>", "hash from the reviewed rename plan")
      .option("--yes", "confirm mutation"),
  ).action(async (from: string, to: string, options: ApplyOptions) => {
    await confirmed(options.yes);
    output(
      await (await publisherFor(program)).applyTagRename({
        from,
        to,
        mode: mode(options),
        expectedHash: options.expectedHash,
      }),
      options.json,
    );
  });
}
