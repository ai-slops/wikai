import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { ConfigSchema } from "../model/index.ts";
import { auditDist } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("checks MDX public bytes against approval independently of the renderer manifest", async () => {
  // Given trusted staging that approves one content-addressed MDX script.
  const root = await mkdtemp(join(tmpdir(), "wikai-audit-renderer-"));
  roots.push(root);
  const staging = join(root, "staging");
  const dist = join(root, "dist");
  await mkdir(staging);
  await mkdir(dist);
  const metadata = {
    id: "pub_page",
    kind: "knowledge",
    slug: "/guide",
    title: "Guide",
    tags: [],
    aliases: [],
    listed: true,
    index: false,
    feed: false,
    featured: false,
  };
  const approvedScript = "approved bytes";
  const approvedHash = hash(approvedScript);
  const publicPath = `_assets/mdx/${approvedHash.slice(7)}.js`;
  const rendererInput = {
    protocol: "wikai-static-renderer",
    version: 1,
    siteUrl: "https://example.test",
    pages: [
      {
        metadata,
        content: {
          type: "mdx",
          runtime: "react-19",
          markdown: "# Guide",
          fallbackHtml: "<h1>Guide</h1>",
          html: {
            artifactPath: "renderer-artifacts/mdx/page.html",
            hash: hash("<h1>Guide</h1>"),
            mime: "text/html",
            bytes: 14,
          },
          scripts: [
            {
              artifactPath: "renderer-artifacts/mdx/client.js",
              publicPath: `/${publicPath}`,
              hash: approvedHash,
              mime: "text/javascript",
              bytes: approvedScript.length,
            },
          ],
          styles: [],
        },
        outgoingLinks: [],
        backlinks: [],
        assets: [],
      },
    ],
    redirects: [],
    assets: [],
    tagTree: [],
  };
  await writeFile(join(staging, "renderer-input.json"), JSON.stringify(rendererInput));
  await writeFile(
    join(staging, "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages: [metadata] }),
  );
  await writeFile(
    join(staging, "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
  await writeFile(
    join(staging, "content-index.json"),
    JSON.stringify({ schemaVersion: 1, pages: [{ assets: [] }] }),
  );
  const emitted = new Map([
    ["guide/index.html", '<meta name="robots" content="noindex"><h1>Guide</h1>'],
    [publicPath, "tampered bytes"],
    [
      "publication-manifest.json",
      await readFile(join(staging, "publication-manifest.json"), "utf8"),
    ],
    ["redirects.json", await readFile(join(staging, "redirects.json"), "utf8")],
  ]);
  for (const [path, bytes] of emitted) {
    await mkdir(dirname(join(dist, path)), { recursive: true });
    await writeFile(join(dist, path), bytes);
  }
  await writeFile(
    join(dist, "renderer-output.json"),
    JSON.stringify({
      protocol: "wikai-static-renderer",
      version: 1,
      files: [...emitted].map(([path, bytes]) =>
        path === "guide/index.html"
          ? { path, hash: hash(bytes), type: "route", route: "/guide" }
          : { path, hash: hash(bytes), type: path.endsWith(".json") ? "policy" : "asset" },
      ),
    }),
  );
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
      capabilities: ["html", "mdx-react-19"],
      reservedRoutes: [],
      requiredRoutes: [],
      assetPrefixes: [],
    },
  });

  // When the declared output is audited.
  const codes = (await auditDist(dist, config)).map((item) => item.code);

  // Then the approved artifact hash wins over the renderer's self-consistent claim.
  expect(codes).toContain("AUDIT_ASSET_HASH_MISMATCH");
});
