import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { z } from "zod";
import { confirmed, output, publisherFor } from "./helpers.ts";

type SourceOptions = {
  readonly sourceId: string;
  readonly referenceIndex?: number;
  readonly heading?: string;
  readonly block?: string;
  readonly lines?: string;
  readonly json?: boolean;
};

type ApplyOptions = SourceOptions & {
  readonly bodyFile: string;
  readonly expectedHash: string;
  readonly yes?: boolean;
};

function selectorOptions(command: Command): Command {
  return command
    .requiredOption("--source-id <id>", "tracked private source ID")
    .option("--reference-index <index>", "zero-based source reference index", (value) =>
      z.coerce.number().int().nonnegative().parse(value),
    )
    .option("--heading <heading>", "select a source heading")
    .option("--block <block>", "select a source block")
    .option("--lines <start:end>", "select inclusive source body lines")
    .option("--json", "emit JSON");
}

function sourceInput(options: SourceOptions) {
  return {
    sourceId: options.sourceId,
    ...(options.referenceIndex === undefined ? {} : { referenceIndex: options.referenceIndex }),
    ...(options.heading === undefined ? {} : { heading: options.heading }),
    ...(options.block === undefined ? {} : { block: options.block }),
    ...(options.lines === undefined ? {} : { lines: options.lines }),
  };
}

export function registerSourceUpdate(program: Command): void {
  const sourceUpdate = program
    .command("source-update")
    .description("Plan or apply a reviewed source merge");

  selectorOptions(
    sourceUpdate
      .command("plan")
      .description("Inspect a source merge without changing the projection")
      .argument("<public-id>", "projection publication ID"),
  ).action(async (publicId: string, options: SourceOptions) => {
    output(
      await (await publisherFor(program)).sourceUpdate(publicId, sourceInput(options)),
      options.json,
    );
  });

  selectorOptions(
    sourceUpdate
      .command("apply")
      .description("Apply an explicitly reviewed source merge")
      .argument("<public-id>", "projection publication ID")
      .requiredOption("--body-file <path>", "UTF-8 file containing the reviewed merged body")
      .requiredOption("--expected-hash <hash>", "hash from the reviewed source-update plan")
      .option("--yes", "confirm mutation"),
  ).action(async (publicId: string, options: ApplyOptions) => {
    await confirmed(options.yes);
    output(
      await (await publisherFor(program)).applySourceUpdate(publicId, {
        ...sourceInput(options),
        expectedHash: options.expectedHash,
        body: await readFile(options.bodyFile, "utf8"),
      }),
      options.json,
    );
  });
}
