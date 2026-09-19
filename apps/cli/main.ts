import { CommanderError } from "commander";
import { z } from "zod";
import { PublisherError } from "../../packages/model/index.ts";
import { createProgram } from "./commands.ts";

export async function run(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

function fail(error: unknown): never {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exit(0);
    process.stderr.write(`CLI_USAGE: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  if (error instanceof PublisherError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exit(error.code === "CONFIRMATION_REQUIRED" ? 2 : 1);
  }
  if (error instanceof z.ZodError) {
    process.stderr.write("INVALID_INPUT: Command input is invalid\n");
    process.exit(2);
  }
  process.stderr.write("INTERNAL_ERROR: The publisher command failed safely\n");
  process.exit(1);
}

run().catch(fail); // no-excuse-ok: catch
