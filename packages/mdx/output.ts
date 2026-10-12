import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MdxError } from "./error.ts";

export type MdxRuntimeOutput = {
  readonly html: { readonly path: string; readonly data: Buffer };
  readonly scripts: readonly { readonly path: string; readonly data: Buffer }[];
  readonly styles: readonly { readonly path: string; readonly data: Buffer }[];
};

const expectedNames = new Set(["index.html", "client.js", "client.css"]);

export async function readMdxOutput(output: string): Promise<MdxRuntimeOutput> {
  try {
    const root = resolve(output);
    const names = (await readdir(root)).sort((left, right) => left.localeCompare(right));
    if (!names.includes("index.html") || !names.includes("client.js")) {
      throw new MdxError("MDX_COMPILE_FAILED", "MDX runtime did not produce an artifact");
    }
    const paths = names.map((name) => ({ name, path: resolve(root, name) }));
    for (const item of paths) {
      const stat = await lstat(item.path);
      if (
        !expectedNames.has(item.name) ||
        dirname(item.path) !== root ||
        !stat.isFile() ||
        stat.nlink !== 1
      ) {
        throw new MdxError("MDX_COMPILE_FAILED", "MDX runtime produced an invalid artifact tree");
      }
    }
    const files = new Map(
      await Promise.all(
        paths.map(
          async ({ name, path }) => [name, { path: name, data: await readFile(path) }] as const,
        ),
      ),
    );
    const html = files.get("index.html");
    const script = files.get("client.js");
    if (html === undefined || script === undefined) {
      throw new MdxError("MDX_COMPILE_FAILED", "MDX runtime did not produce an artifact");
    }
    const style = files.get("client.css");
    return { html, scripts: [script], styles: style === undefined ? [] : [style] };
  } catch (error) {
    if (error instanceof MdxError) throw error;
    throw new MdxError("MDX_COMPILE_FAILED", "MDX runtime produced an invalid artifact tree");
  }
}
