import type { Command } from "commander";
import { z } from "zod";
import { PublisherError } from "../../packages/model/index.ts";
import { markdownDiff, publicationDiff } from "./diff.ts";
import { output, publisherFor } from "./helpers.ts";

type ReadOptions = { readonly json?: boolean };

export function registerReadCommands(program: Command): void {
  program
    .command("status")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions) => {
      output(await (await publisherFor(program)).status(), options.json);
    });
  program
    .command("plan")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions) => {
      output(await (await publisherFor(program)).plan(), options.json);
    });
  program
    .command("validate")
    .option("--strict", "treat warnings as failures")
    .option("--json", "emit JSON")
    .action(async (options: ReadOptions & { readonly strict?: boolean }) => {
      const plan = await (await publisherFor(program)).plan();
      output(plan.diagnostics, options.json);
      if (
        plan.diagnostics.some(
          (item) => item.severity === "error" || (options.strict && item.severity === "warning"),
        )
      ) {
        throw new PublisherError("VALIDATION_FAILED", "Publication validation failed");
      }
    });
  program
    .command("preview")
    .argument("[public-id]")
    .option("--public-id <id>", "preview one publication")
    .option("--working", "preview working content (default)")
    .option("--approved", "preview approved content")
    .option("--json", "emit JSON")
    .action(
      async (
        id: string | undefined,
        options: ReadOptions & {
          readonly publicId?: string;
          readonly working?: boolean;
          readonly approved?: boolean;
        },
      ) => {
        if (options.working && options.approved)
          throw new PublisherError("PREVIEW_MODE_REQUIRED", "Choose one preview mode");
        output(
          await (await publisherFor(program)).preview(
            options.approved ? "approved" : "working",
            options.publicId ?? id,
          ),
          options.json,
        );
      },
    );
  program
    .command("diff")
    .argument("<public-id>")
    .option("--json", "emit JSON")
    .option("--format <format>", "json or markdown", "markdown")
    .action(async (id: string, options: ReadOptions & { readonly format: string }) => {
      const format = z.enum(["json", "markdown"]).parse(options.format);
      const detail = await (await publisherFor(program)).detail(id);
      output(
        options.json || format === "json" ? publicationDiff(detail) : markdownDiff(detail),
        options.json,
      );
    });
  program
    .command("audit")
    .argument("[path]")
    .option("--json", "emit JSON")
    .action(async (path: string | undefined, options: ReadOptions) => {
      const publisher = await publisherFor(program);
      const diagnostics = await publisher.audit(path ?? publisher.config.site.distDir);
      output(diagnostics, options.json);
      if (diagnostics.some((item) => item.severity === "error"))
        throw new PublisherError("AUDIT_FAILED", "Distribution privacy audit failed");
    });
}
