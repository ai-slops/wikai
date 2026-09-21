import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, z } from "zod";
import { PublisherError } from "../../packages/model/index.ts";
import type { MetadataPatch } from "../../packages/service/schema.ts";
import type { CandidateInput, ExtractInput, ProjectInput } from "./api-schemas.ts";
import { registerApiRoutes } from "./routes.ts";
import { securityMiddleware } from "./security.ts";

export interface PublisherPort {
  status(): Promise<unknown>;
  plan(): Promise<unknown>;
  detail(publicId: string): Promise<unknown>;
  approve(publicId: string, expectedHash: string): Promise<unknown>;
  withdraw(publicId: string, expectedHash: string, redirect?: string): Promise<void>;
  candidate(input: CandidateInput): Promise<unknown>;
  project(input: ProjectInput): Promise<unknown>;
  extract(input: ExtractInput): Promise<unknown>;
  updateMetadata(publicId: string, patch: MetadataPatch, expectedHash: string): Promise<unknown>;
  preview(mode: "working" | "approved", publicId?: string): Promise<unknown>;
  build(): Promise<unknown>;
  audit(path: string): Promise<unknown>;
  restore(publicId: string, revisionHash: string, expectedHash: string): Promise<unknown>;
}

type DashboardOptions = {
  readonly publisher: PublisherPort;
  readonly csrfToken: string;
  readonly allowedOrigin: string;
  readonly bearerToken?: string;
};

const portSchema = z.coerce.number().int().min(1).max(65_535).default(3000);
const hostSchema = z.string().trim().min(1).max(253);
const tokenSchema = z.string().min(32).max(4096);
const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const assets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/tokens.css", { file: "tokens.css", type: "text/css; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/queue.css", { file: "queue.css", type: "text/css; charset=utf-8" }],
  ["/review.css", { file: "review.css", type: "text/css; charset=utf-8" }],
  ["/responsive.css", { file: "responsive.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/api.js", { file: "api.js", type: "text/javascript; charset=utf-8" }],
  ["/preview-loader.js", { file: "preview-loader.js", type: "text/javascript; charset=utf-8" }],
  ["/render.js", { file: "render.js", type: "text/javascript; charset=utf-8" }],
  ["/workflow.js", { file: "workflow.js", type: "text/javascript; charset=utf-8" }],
  ["/metadata.js", { file: "metadata.js", type: "text/javascript; charset=utf-8" }],
  ["/interactions.js", { file: "interactions.js", type: "text/javascript; charset=utf-8" }],
]);

export function createDashboardApp(options: DashboardOptions): Hono {
  const app = new Hono();
  app.use("*", securityMiddleware(options));
  registerApiRoutes(app, options.publisher, options.csrfToken);
  for (const [path, asset] of assets) {
    app.get(path, async (context) =>
      context.body(await readFile(`${publicRoot}${asset.file}`), 200, {
        "Content-Type": asset.type,
      }),
    );
  }
  app.notFound((context) =>
    context.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );
  app.onError((error, context) => {
    if (error instanceof ZodError)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Request did not match the API contract",
            issues: error.issues,
          },
        },
        400,
      );
    if (error instanceof HTTPException)
      return context.json({ error: { code: "HTTP_ERROR", message: error.message } }, error.status);
    if (error instanceof PublisherError) {
      const status = error.code === "PUBLICATION_NOT_FOUND" ? 404 : 409;
      return context.json({ error: { code: error.code, message: error.message } }, status);
    }
    return context.json(
      {
        error: { code: "INTERNAL_ERROR", message: "The publisher could not complete the request" },
      },
      500,
    );
  });
  return app;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

type ServerConfig = {
  readonly host: string;
  readonly port: number;
  readonly configPath: string;
  readonly allowedOrigin: string;
  readonly token?: string;
};

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const host = hostSchema.parse(environment["WIKAI_HOST"] ?? "127.0.0.1");
  const port = portSchema.parse(environment["WIKAI_PORT"] ?? 3000);
  const suppliedToken = environment["WIKAI_TOKEN"];
  const token =
    isLoopback(host) && suppliedToken === undefined ? undefined : tokenSchema.parse(suppliedToken);
  const originHost = host === "::1" ? "[::1]" : host;
  return {
    host,
    port,
    configPath: environment["WIKAI_CONFIG"] ?? ".local/publisher.config.yaml",
    allowedOrigin: environment["WIKAI_ORIGIN"] ?? `http://${originHost}:${port}`,
    ...(token === undefined ? {} : { token }),
  };
}

export async function startServer(): Promise<unknown> {
  const config = parseServerConfig(process.env);
  const { Publisher } = await import("../../packages/service/index.ts");
  const publisher = await Publisher.open(config.configPath);
  const app = createDashboardApp({
    publisher,
    csrfToken: randomBytes(32).toString("base64url"),
    allowedOrigin: config.allowedOrigin,
    ...(config.token === undefined ? {} : { bearerToken: config.token }),
  });
  return serve({ fetch: app.fetch, hostname: config.host, port: config.port });
}
