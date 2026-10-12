import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { type ApprovedRevision, ConfigSchema } from "../model/index.ts";
import { buildReleaseStaging } from "../release/index.ts";
import { auditDist } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wikai-audit-protocol-"));
  roots.push(root);
  const staging = join(root, "staging");
  const dist = join(root, "dist");
  const config = ConfigSchema.parse({
    vault: { root: join(root, "vault") },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: staging,
    },
    site: { sourceDir: join(root, "site"), distDir: dist, url: "https://example.test" },
    renderer: {
      profile: "docker",
      protocolVersion: 1,
      image: "renderer:test",
      capabilities: ["html", "markdown"],
      reservedRoutes: [],
      requiredRoutes: [],
      assetPrefixes: [],
    },
  });
  const revision: ApprovedRevision = {
    publicId: "pub_legacy",
    revisionHash: hash("revision"),
    exposureHash: hash("exposure"),
    metadata: {
      id: "pub_legacy",
      kind: "page",
      slug: "/legacy.xml",
      title: "Legacy feed",
      tags: [],
      aliases: [],
      listed: false,
      index: false,
      feed: false,
      featured: false,
    },
    markdown: "Legacy feed",
    html: "<feed>legacy</feed>",
    outgoingLinks: [],
    assets: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
  };
  await buildReleaseStaging([revision], config);
  await mkdir(dist);
  const route = "<feed>legacy</feed>";
  const manifest = await readFile(join(staging, "publication-manifest.json"));
  const redirects = await readFile(join(staging, "redirects.json"));
  await writeFile(join(dist, "legacy.xml"), route);
  await writeFile(join(dist, "publication-manifest.json"), manifest);
  await writeFile(join(dist, "redirects.json"), redirects);
  const writeOutput = async (): Promise<void> => {
    const publicManifest = await readFile(join(dist, "publication-manifest.json"));
    await writeFile(
      join(dist, "renderer-output.json"),
      JSON.stringify({
        protocol: "wikai-static-renderer",
        version: 1,
        files: [
          { path: "legacy.xml", hash: hash(route), type: "route", route: "/legacy.xml" },
          { path: "publication-manifest.json", hash: hash(publicManifest), type: "policy" },
          { path: "redirects.json", hash: hash(redirects), type: "policy" },
        ],
      }),
    );
  };
  await writeOutput();
  return { config, dist, staging, writeOutput };
}

it("accepts a custom content route whose canonical route has a file extension", async () => {
  // Given a renderer that maps /legacy.xml directly to legacy.xml.
  const { config, dist } = await fixture();

  // When the exported output is audited.
  const errors = (await auditDist(dist, config)).filter((item) => item.severity === "error");

  // Then the shared protocol path mapping accepts the extension route.
  expect(errors).toEqual([]);
});

it("rejects policy bytes that add fields hidden by schema normalization", async () => {
  // Given self-consistent renderer output whose public manifest has an extra JSON field.
  const { config, dist, writeOutput } = await fixture();
  const manifest = JSON.parse(await readFile(join(dist, "publication-manifest.json"), "utf8"));
  await writeFile(
    join(dist, "publication-manifest.json"),
    JSON.stringify({ ...manifest, extra: true }),
  );
  await writeOutput();

  // When the exported output is audited.
  const codes = (await auditDist(dist, config)).map((item) => item.code);

  // Then exact staged policy bytes remain authoritative.
  expect(codes).toContain("AUDIT_ROUTE_POLICY_MISMATCH");
});

it("rejects an unsafe output tree before reading linked policy content", async () => {
  // Given a policy path replaced by a benign symbolic link to a directory.
  const { config, dist } = await fixture();
  const manifestPath = join(dist, "publication-manifest.json");
  await rm(manifestPath);
  await symlink(dist, manifestPath);

  // When the exported output is audited.
  const result = auditDist(dist, config);

  // Then audit resolves with the tree diagnostic without dereferencing the policy link.
  await expect(result).resolves.toMatchObject([{ code: "AUDIT_SYMLINK" }]);
});

it("rejects non-regular output entries before reading renderer files", async () => {
  // Given an otherwise valid renderer output containing a temporary Unix socket.
  const { config, dist } = await fixture();
  await using server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(join(dist, "renderer.sock"), resolve);
  });

  // When the exported output is audited.
  const diagnostics = await auditDist(dist, config);

  // Then the non-regular entry rejects the tree before renderer files are read.
  expect(diagnostics).toMatchObject([{ code: "AUDIT_NONREGULAR_FILE" }]);
});
