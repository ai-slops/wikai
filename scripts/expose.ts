import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { createDashboardApp } from "../apps/dashboard/server.ts";
import { atomicWrite, readOptional } from "../packages/fs/index.ts";
import { PublisherError } from "../packages/model/index.ts";
import { Publisher } from "../packages/service/index.ts";

const passwordFile = resolve(".local/studio-password");
const storedPassword = await readOptional(passwordFile);
const password = z
  .string()
  .min(32)
  .max(4096)
  .parse(storedPassword?.trim() ?? randomBytes(32).toString("base64url"));
if (storedPassword === undefined) await atomicWrite(passwordFile, `${password}\n`);
const bootstrapOptions = {
  publisher: await Publisher.open(process.env["WIKAI_CONFIG"]),
  csrfToken: randomBytes(32).toString("base64url"),
  allowedOrigin: "https://unconfigured.invalid",
  bearerToken: password,
};
const app = createDashboardApp(bootstrapOptions);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
await once(server, "listening");

try {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new PublisherError("DASHBOARD_BIND_FAILED", "Dashboard did not bind a TCP port");
  const result = await promisify(execFile)(
    "dim-development-service",
    [
      "expose",
      "--name",
      "wikai-studio",
      "--port",
      String(address.port),
      "--ingress",
      "https-ts",
      "--require-scheme",
      "https",
    ],
    { timeout: 15_000, maxBuffer: 65_536 },
  );
  const external = new URL(z.url().parse(result.stdout.trim()));
  if (
    external.protocol !== "https:" ||
    external.username ||
    external.password ||
    external.pathname !== "/" ||
    external.search ||
    external.hash
  ) {
    throw new PublisherError(
      "INVALID_EXTERNAL_URL",
      "DIM must return a credential-free HTTPS origin",
    );
  }
  bootstrapOptions.allowedOrigin = external.origin;
  await atomicWrite(
    resolve(".local/external-studio.json"),
    `${JSON.stringify({ url: external.origin, username: "wikai", passwordFile, pid: process.pid, port: address.port }, null, 2)}\n`,
  );
  console.log(`Studio: ${external.origin}\nUsername: wikai\nPassword file: ${passwordFile}`);
} catch (error) {
  server.close();
  throw error;
}

process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
