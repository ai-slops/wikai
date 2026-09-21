import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { PublisherError } from "../../packages/model/index.ts";
import { Publisher } from "../../packages/service/index.ts";

export function output(value: unknown, json = false): void {
  process.stdout.write(
    `${json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value}\n`,
  );
}

export async function confirmed(yes: boolean | undefined): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PublisherError("CONFIRMATION_REQUIRED", "Mutation requires --yes confirmation");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("Apply this mutation? [y/N] ");
    if (!/^y(?:es)?$/iu.test(answer.trim())) {
      throw new PublisherError("CONFIRMATION_REQUIRED", "Mutation was not confirmed");
    }
  } finally {
    prompt.close();
  }
}

export function publisherFor(program: Command): Promise<Publisher> {
  const config = program.opts<{ config?: string }>().config;
  return config === undefined ? Publisher.open() : Publisher.open(config);
}
