import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { readMdxOutput } from "./output.ts";

const roots: string[] = [];
const run = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function outputFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wikai-mdx-output-"));
  roots.push(root);
  await writeFile(join(root, "index.html"), '<div id="wikai-mdx-root">Counter</div>');
  await writeFile(join(root, "client.js"), "export {};\n");
  return root;
}

it("reads only the expected top-level regular artifacts", async () => {
  // Given the complete expected runtime output.
  const root = await outputFixture();
  await writeFile(join(root, "client.css"), "button { color: black; }\n");

  // When the exported output tree is ingested.
  const output = await readMdxOutput(root);

  // Then each expected regular file is returned.
  expect(output.html.path).toBe("index.html");
  expect(output.scripts.map((file) => file.path)).toEqual(["client.js"]);
  expect(output.styles.map((file) => file.path)).toEqual(["client.css"]);
});

it("rejects an unexpected top-level file before artifact ingestion", async () => {
  // Given valid output plus an unrelated benign temporary file.
  const root = await outputFixture();
  await writeFile(join(root, "notes.txt"), "temporary\n");

  // When the exported output tree is ingested.
  const action = readMdxOutput(root);

  // Then the closed artifact boundary rejects the complete tree.
  await expect(action).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
});

it("rejects nested output entries", async () => {
  // Given valid output plus a benign nested directory.
  const root = await outputFixture();
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "extra.js"), "export {};\n");

  // When the exported output tree is ingested.
  const action = readMdxOutput(root);

  // Then no directory or nested artifact enters the host read boundary.
  await expect(action).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
});

it("rejects symbolic-link artifacts", async () => {
  // Given an expected artifact name replaced by a benign local symbolic link.
  const root = await outputFixture();
  await rm(join(root, "client.js"));
  await writeFile(join(root, "target.js"), "export {};\n");
  await symlink("target.js", join(root, "client.js"));

  // When the exported output tree is ingested.
  const action = readMdxOutput(root);

  // Then links are rejected before their target can be read.
  await expect(action).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
});

it("rejects hard-link artifacts", async () => {
  // Given an expected artifact name hard-linked to a benign external temporary file.
  const root = await outputFixture();
  const external = await mkdtemp(join(tmpdir(), "wikai-mdx-output-external-"));
  roots.push(external);
  const target = join(external, "target.js");
  await writeFile(target, "export {};\n");
  await rm(join(root, "client.js"));
  await link(target, join(root, "client.js"));

  // When the exported output tree is ingested.
  const action = readMdxOutput(root);

  // Then multiply linked files cannot cross the artifact boundary.
  await expect(action).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
});

it("rejects special-file artifacts before reading them", async () => {
  // Given an expected artifact name replaced by a benign FIFO.
  const root = await outputFixture();
  await rm(join(root, "client.js"));
  await run("mkfifo", [join(root, "client.js")]);

  // When the exported output tree is ingested.
  const action = readMdxOutput(root);

  // Then the non-regular file is rejected without opening the FIFO.
  await expect(action).rejects.toMatchObject({ code: "MDX_COMPILE_FAILED" });
});
