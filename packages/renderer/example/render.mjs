import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const staging = "/staging";
const output = "/dist";
const input = JSON.parse(await readFile(join(staging, "renderer-input.json"), "utf8"));
const files = [];
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const routePath = (route) => {
  if (route === "/") return "index.html";
  const relative = route.slice(1);
  return relative.split("/").at(-1).includes(".") ? relative : `${relative}/index.html`;
};
const emit = async (path, bytes, descriptor) => {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files.push({ path, hash: digest(bytes), ...descriptor });
};

for (const page of input.pages) {
  const body = page.content.type === "mdx" ? page.content.fallbackHtml : page.content.html;
  const assets =
    page.content.type === "mdx"
      ? [...page.content.scripts, ...page.content.styles]
          .map((file) => `<link rel="preload" href="${file.publicPath}">`)
          .join("")
      : "";
  const bytes = Buffer.from(
    `<!doctype html><html><head>${assets}</head><body>${body}</body></html>`,
  );
  await emit(routePath(page.metadata.slug), bytes, { type: "route", route: page.metadata.slug });
}
for (const asset of input.assets) {
  const path = asset.publicPath.replace(/^\/+/, "");
  const bytes = await readFile(join(staging, path));
  await emit(path, bytes, { type: "asset" });
}
for (const page of input.pages) {
  if (page.content.type !== "mdx") continue;
  for (const artifact of [...page.content.scripts, ...page.content.styles]) {
    const path = artifact.publicPath.replace(/^\/+/, "");
    const target = join(output, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(staging, artifact.artifactPath), target);
    files.push({ path, hash: artifact.hash, type: "asset" });
  }
}
for (const path of ["publication-manifest.json", "redirects.json"]) {
  await emit(path, await readFile(join(staging, path)), { type: "policy" });
}
await writeFile(
  join(output, "renderer-output.json"),
  `${JSON.stringify({ protocol: "wikai-static-renderer", version: 1, files })}\n`,
);
