import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { type ApprovedRevision, ConfigSchema } from "../model/index.ts";
import { buildReleaseStaging, buildSite } from "../release/index.ts";

const { WIKAI_RENDERER_DOCKER_TEST: dockerTestFlag } = process.env;
const dockerTest = dockerTestFlag === "1" ? it : it.skip;
const execute = promisify(execFile);
const image = `wikai-minimal-renderer-test-${process.pid}`;
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  if (dockerTestFlag === "1") {
    await execute("docker", ["image", "rm", "--force", image]);
  }
});

dockerTest(
  "builds a non-Astro image through the release API without legacy route assumptions",
  async () => {
    // Given a local prebuilt protocol adapter and a canonical route outside the knowledge prefix.
    const fixture = fileURLToPath(new URL("./example", import.meta.url));
    await execute("docker", ["build", "--network=none", "--tag", image, fixture]);
    const root = await mkdtemp(join(tmpdir(), "wikai-renderer-docker-"));
    roots.push(root);
    const config = ConfigSchema.parse({
      vault: { root: join(root, "vault") },
      publisher: {
        stateDir: join(root, "state"),
        previewStagingDir: join(root, "preview"),
        releaseStagingDir: join(root, "release"),
      },
      site: {
        sourceDir: join(root, "unused-site"),
        distDir: join(root, "dist"),
        url: "https://example.test",
      },
      renderer: {
        profile: "docker",
        protocolVersion: 1,
        image,
        capabilities: ["html", "markdown"],
        reservedRoutes: [],
        requiredRoutes: [],
        assetPrefixes: [],
      },
    });
    const revision: ApprovedRevision = {
      publicId: "pub_hello",
      revisionHash: hash("revision"),
      exposureHash: hash("exposure"),
      metadata: {
        id: "pub_hello",
        kind: "knowledge",
        slug: "/notes/hello",
        title: "Hello",
        tags: ["notes"],
        aliases: [],
        listed: true,
        index: true,
        feed: false,
        featured: false,
      },
      markdown: "# Hello",
      html: "<h1>Hello</h1>",
      outgoingLinks: [],
      assets: [],
      approvedAt: "2026-01-01T00:00:00.000Z",
    };

    // When the same release staging and build APIs execute with networking disabled.
    await buildReleaseStaging([revision], config);
    await buildSite(config);

    // Then only the adapter-declared route is built and no Astro category surface is required.
    expect(await readFile(join(root, "dist", "notes/hello/index.html"), "utf8")).toContain("Hello");
    await expect(readFile(join(root, "dist", "about/index.html"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
  120_000,
);
