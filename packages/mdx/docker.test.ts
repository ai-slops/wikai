import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConfigSchema } from "../model/index.ts";
import { compileMdx } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.runIf(process.env["WIKAI_MDX_DOCKER_TEST"] === "1")(
  "compiles imported stateful React MDX in the isolated image",
  async () => {
    // Given standard MDX importing a stateful component and public JSON data.
    const root = await mkdtemp(join(tmpdir(), "wikai-mdx-docker-test-"));
    roots.push(root);
    await mkdir(join(root, "public-components"));
    await mkdir(join(root, "public-data"));
    await writeFile(
      join(root, "public-components", "Counter.tsx"),
      `import { useState } from "react";
export function Counter({ label }) {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{label}: {count}</button>
}
`,
    );
    await writeFile(join(root, "public-data", "counter.json"), '{"label":"Clicks"}\n');
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
    const body = `import { Counter } from './public-components/Counter.tsx'
import data from './public-data/counter.json'

# Interactive {data.label}

<Counter label={data.label} />
`;

    // When the isolated Docker compiler creates an artifact.
    const snapshot = await compileMdx({ body, sourcePath: "counter.mdx", config });
    const dockerHost = process.env["DOCKER_HOST"];
    process.env["DOCKER_HOST"] = "tcp://127.0.0.1:1";
    const unavailable = expect(
      compileMdx({ body, sourcePath: "counter.mdx", config }).finally(() => {
        if (dockerHost === undefined) delete process.env["DOCKER_HOST"];
        else process.env["DOCKER_HOST"] = dockerHost;
      }),
    ).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });

    // Then SSR fallback and a self-contained client bundle are both present.
    const html = Buffer.from(snapshot.artifact.html.data, "base64").toString();
    expect(html).toContain("<h1>");
    expect(html.replaceAll("<!-- -->", "").replace(/<[^>]+>/gu, "")).toContain("Clicks: 0");
    expect(snapshot.artifact.scripts).toHaveLength(1);
    expect(snapshot.dependencies).toHaveLength(2);
    expect(snapshot.runtime.imageId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await unavailable;
    await expect(
      compileMdx({ body, sourcePath: "nested/counter.mdx", config }),
    ).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
    await expect(compileMdx({ body, sourcePath: "counter.mdx", config })).resolves.toEqual(
      snapshot,
    );
  },
  60_000,
);
