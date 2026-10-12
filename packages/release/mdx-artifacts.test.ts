import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { type ApprovedRevision, ConfigSchema, type MdxFile } from "../model/index.ts";
import { RendererInputSchema } from "../renderer/index.ts";
import { buildReleaseStaging } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const artifact = (path: string, text: string, mime: string): MdxFile => ({
  path,
  hash: hash(text),
  mime,
  bytes: Buffer.byteLength(text),
  data: Buffer.from(text).toString("base64"),
});

it("stages only hash-addressed public MDX artifacts in renderer input", async () => {
  // Given an approved MDX revision containing executable output and a private dependency snapshot.
  const root = await mkdtemp(join(tmpdir(), "wikai-release-mdx-"));
  roots.push(root);
  const script = artifact("client.js", "console.log('public')", "text/javascript; charset=utf-8");
  const html = artifact("index.html", "<div>Public</div>", "text/html; charset=utf-8");
  const dependency = artifact(
    "public-components/PrivateName.tsx",
    "export const label='private dependency'",
    "text/javascript; charset=utf-8",
  );
  const revision: ApprovedRevision = {
    publicId: "pub_mdx",
    revisionHash: hash("revision"),
    exposureHash: hash("exposure"),
    metadata: {
      id: "pub_mdx",
      kind: "knowledge",
      slug: "/guide",
      title: "Guide",
      tags: ["docs/api"],
      aliases: [],
      listed: true,
      index: true,
      feed: false,
      featured: false,
    },
    markdown: "# Guide",
    html: "<div>Public</div>",
    outgoingLinks: [],
    assets: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
    mdx: {
      schemaVersion: 1,
      contentInputHash: hash("# Guide"),
      profileDigest: hash("profile"),
      runtime: { image: "wikai-mdx:test", lockHash: hash("lock"), runtimeHash: hash("runtime") },
      dependencies: [dependency],
      artifact: { html, scripts: [script], styles: [] },
    },
  };
  const config = ConfigSchema.parse({
    vault: { root: join(root, "vault") },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: join(root, "release"),
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
    renderer: {
      profile: "docker",
      protocolVersion: 1,
      image: "renderer:test",
      capabilities: ["html", "mdx-react-19"],
      reservedRoutes: [],
      requiredRoutes: [],
      assetPrefixes: ["assets/"],
    },
  });

  // When release staging is built through the generic protocol.
  await buildReleaseStaging([revision], config);
  const raw = await readFile(join(root, "release", "renderer-input.json"), "utf8");
  const input = RendererInputSchema.parse(JSON.parse(raw));

  // Then only public descriptors are exposed and executable bytes are hash-addressed and verifiable.
  expect(raw).not.toContain("PrivateName");
  expect(raw).not.toContain("private dependency");
  expect(raw).not.toContain("wikai-mdx:test");
  expect(input.pages[0]?.content.type).toBe("mdx");
  const publicScript =
    input.pages[0]?.content.type === "mdx" ? input.pages[0].content.scripts[0] : undefined;
  expect(publicScript?.publicPath).toBe(`/_assets/mdx/${script.hash.slice(7)}.js`);
  expect(hash(await readFile(join(root, "release", publicScript?.artifactPath ?? "")))).toBe(
    script.hash,
  );
});

it("rejects an approved MDX runtime unsupported by the selected renderer", async () => {
  // Given an approved React 19 MDX artifact and a renderer without that capability.
  const root = await mkdtemp(join(tmpdir(), "wikai-release-mdx-incompatible-"));
  roots.push(root);
  const script = artifact("client.js", "export default 1", "text/javascript; charset=utf-8");
  const html = artifact("index.html", "<p>MDX</p>", "text/html; charset=utf-8");
  const revision: ApprovedRevision = {
    publicId: "pub_mdx",
    revisionHash: hash("revision"),
    exposureHash: hash("exposure"),
    metadata: {
      id: "pub_mdx",
      kind: "knowledge",
      slug: "/guide",
      title: "Guide",
      tags: [],
      aliases: [],
      listed: true,
      index: true,
      feed: false,
      featured: false,
    },
    markdown: "# Guide",
    html: "<p>MDX</p>",
    outgoingLinks: [],
    assets: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
    mdx: {
      schemaVersion: 1,
      contentInputHash: hash("# Guide"),
      profileDigest: hash("profile"),
      runtime: { image: "wikai-mdx:test", lockHash: hash("lock"), runtimeHash: hash("runtime") },
      dependencies: [],
      artifact: { html, scripts: [script], styles: [] },
    },
  };
  const config = ConfigSchema.parse({
    vault: { root: join(root, "vault") },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: join(root, "release"),
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
    renderer: {
      profile: "docker",
      protocolVersion: 1,
      image: "renderer:test",
      capabilities: ["html"],
      reservedRoutes: [],
      requiredRoutes: [],
      assetPrefixes: [],
    },
  });

  // When release staging is attempted, then flattening is refused before renderer execution.
  await expect(buildReleaseStaging([revision], config)).rejects.toMatchObject({
    code: "RELEASE_RENDERER_MDX_INCOMPATIBLE",
  });
});
