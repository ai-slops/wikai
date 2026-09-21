import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const source = process.env.WIKAI_RENDER_DIR;
const target = process.env.WIKAI_OUT_DIR;

if (source !== undefined && target !== undefined && source !== target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) await cp(join(source, entry), join(target, entry), { recursive: true });
  const staging = process.env.WIKAI_STAGING_DIR;
  if (staging !== undefined) {
    const index = JSON.parse(await readFile(join(staging, "content-index.json"), "utf8"));
    for (const page of index.pages) for (const asset of page.assets) {
      const relativePath = asset.publicPath.replace(/^\/+/, "");
      const input = resolve(staging, relativePath);
      const output = resolve(target, relativePath);
      if (relative(staging, input).startsWith("..") || relative(target, output).startsWith("..")) throw new Error("Unsafe staged asset path");
      await mkdir(dirname(output), { recursive: true });
      await cp(input, output);
    }
  }
}
