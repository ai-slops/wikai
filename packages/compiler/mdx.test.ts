import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { MdxCompiler } from "../mdx/index.ts";
import { createMdxInput, snapshotPublicDependencies } from "../mdx/snapshot.ts";
import { ConfigSchema } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const document = `---
id: prv_counter
public:
  id: pub_counter
  status: review
  mode: mirror
  kind: knowledge
  slug: /knowledge/counter
  title: Counter
  summary: Interactive counter
  contentState: stable
  knowledge:
    documentType: topic
---
import { Counter } from './public-components/Counter.tsx'

# Count {1 + 1}

<Counter />
`;

it("includes standard MDX and the shared profile in compiler exposure", async () => {
  // Given an opted-in MDX publication with imports, expressions and a stateful component.
  const root = await mkdtemp(join(tmpdir(), "wikai-compiler-mdx-"));
  roots.push(root);
  await mkdir(join(root, "public-components"));
  await writeFile(join(root, "counter.mdx"), document);
  await writeFile(
    join(root, "public-components", "Counter.tsx"),
    'import { useState } from "react"; export function Counter(){const [n]=useState(0);return <button>{n}</button>}\n',
  );
  const config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
    },
    mdx: { enabled: true },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
  const renderer: MdxCompiler = async ({ body, sourcePath, config: activeConfig }) => {
    const image = activeConfig.mdx?.image ?? "wikai-mdx:local";
    const imageId = `sha256:${"1".repeat(64)}`;
    const componentRoots = activeConfig.mdx?.componentRoots ?? ["public-components"];
    const dataRoots = activeConfig.mdx?.dataRoots ?? ["public-data"];
    const immutable = createMdxInput({
      body,
      sourcePath,
      snapshot: await snapshotPublicDependencies(activeConfig),
      image,
      imageId,
      componentRoots,
      dataRoots,
    });
    const html = '<div id="wikai-mdx-root"><button>0</button></div>';
    const script = "interactive client";
    return {
      schemaVersion: 1,
      contentInputHash: immutable.contentInputHash,
      profileDigest: immutable.profileDigest,
      runtime: { image, imageId },
      identity: { sourcePath: immutable.sourcePath, componentRoots, dataRoots },
      dependencies: [...immutable.files],
      artifact: {
        html: {
          path: "index.html",
          hash: hash(html),
          mime: "text/html; charset=utf-8",
          bytes: Buffer.byteLength(html),
          data: Buffer.from(html).toString("base64"),
        },
        scripts: [
          {
            path: "client.js",
            hash: hash(script),
            mime: "text/javascript; charset=utf-8",
            bytes: Buffer.byteLength(script),
            data: Buffer.from(script).toString("base64"),
          },
        ],
        styles: [],
      },
    };
  };
  const before = (await compile(await loadVault(config), config, [], renderer)).publications[0];

  // When only the shared component bytes change.
  await writeFile(
    join(root, "public-components", "Counter.tsx"),
    "export function Counter(){return null}\n",
  );
  const after = (await compile(await loadVault(config), config, [], renderer)).publications[0];

  // Then authored input remains stable while profile and exposure require new approval.
  expect(after?.mdx?.contentInputHash).toBe(before?.mdx?.contentInputHash);
  expect(after?.mdx?.profileDigest).not.toBe(before?.mdx?.profileDigest);
  expect(after?.exposureHash).not.toBe(before?.exposureHash);
  expect(after?.html).toContain("wikai-mdx-root");
});
