import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const ArtifactSchema = z.strictObject({
  artifactPath: z.string().min(1),
  publicPath: z.string().startsWith("/"),
  hash: HashSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
const AssetSchema = z.strictObject({
  publicPath: z.string().startsWith("/"),
  hash: HashSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
const InputSchema = z.strictObject({
  protocol: z.literal("wikai-static-renderer"),
  version: z.literal(1),
  siteUrl: z.url(),
  pages: z.array(z.object({
    metadata: z.object({ slug: z.string().startsWith("/"), tags: z.array(z.string()), listed: z.boolean() }).passthrough(),
    content: z.discriminatedUnion("type", [
      z.object({ type: z.literal("markdown") }).passthrough(),
      z.object({ type: z.literal("mdx"), scripts: z.array(ArtifactSchema), styles: z.array(ArtifactSchema) }).passthrough(),
    ]),
    assets: z.array(AssetSchema),
  }).passthrough()),
  redirects: z.array(z.object({ from: z.string().startsWith("/"), to: z.string().startsWith("/"), status: z.literal(301) }).strict()),
  assets: z.array(AssetSchema),
  tagTree: z.array(z.unknown()),
});

const fixedRoutes = [
  "/", "/about", "/now", "/contact", "/search", "/work", "/knowledge", "/log",
  "/categories", "/feed.xml", "/work.xml", "/knowledge.xml", "/log.xml",
  "/feeds/all.xml", "/feeds/work.xml", "/feeds/knowledge.xml", "/feeds/log.xml",
  "/sitemap-0.xml", "/sitemap-index.xml", "/robots.txt",
];
const policyPaths = new Set(["publication-manifest.json", "redirects.json"]);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const routeOutputPath = (route) => {
  if (route === "/") return "index.html";
  const path = route.slice(1);
  return path.split("/").at(-1).includes(".") ? path : `${path}/index.html`;
};
const safeTarget = (root, path) => {
  const target = resolve(root, path.replace(/^\/+/, ""));
  const location = relative(root, target);
  if (location.startsWith("..") || location === "" || location.includes("\\")) throw new Error("Unsafe renderer path");
  return target;
};
const categoryRoutes = (pages) => {
  const routes = new Set(["/categories"]);
  for (const page of pages) {
    if (!page.metadata.listed) continue;
    for (const tag of page.metadata.tags) {
      const [root, ...segments] = tag.split("/");
      if (root !== "category" || segments.length === 0) continue;
      for (let index = 1; index <= segments.length; index += 1) {
        routes.add(`/categories/${segments.slice(0, index).map(encodeURIComponent).join("/")}`);
      }
    }
  }
  return routes;
};
const filesUnder = async (root, path = "") => {
  const files = [];
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
};

const source = process.env.WIKAI_RENDER_DIR;
const target = process.env.WIKAI_OUT_DIR;
const staging = process.env.WIKAI_STAGING_DIR;
const manifestPath = process.env.WIKAI_RENDERER_OUTPUT;
if (source === undefined || target === undefined || staging === undefined || manifestPath === undefined) {
  throw new Error("Renderer output environment is incomplete");
}

const input = InputSchema.parse(JSON.parse(await readFile(join(staging, "renderer-input.json"), "utf8")));
if (resolve(source) !== resolve(target)) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) await cp(join(source, entry), join(target, entry), { recursive: true });
}

const artifacts = input.pages.flatMap((page) => page.content.type === "mdx" ? [...page.content.scripts, ...page.content.styles] : []);
const assets = new Map([...input.assets, ...input.pages.flatMap((page) => page.assets)].map((asset) => [asset.publicPath, asset]));
for (const asset of assets.values()) {
  const output = safeTarget(target, asset.publicPath);
  await mkdir(dirname(output), { recursive: true });
  await cp(safeTarget(staging, asset.publicPath), output);
}
for (const artifact of artifacts) {
  const output = safeTarget(target, artifact.publicPath);
  await mkdir(dirname(output), { recursive: true });
  await cp(safeTarget(staging, artifact.artifactPath), output);
}
for (const path of policyPaths) await cp(join(staging, path), join(target, path));

const routeByPath = new Map(
  [
    ...fixedRoutes,
    ...input.pages.map((page) => page.metadata.slug),
    ...input.redirects.map((redirect) => redirect.from),
    ...categoryRoutes(input.pages),
  ].map((route) => [routeOutputPath(route), route]),
);
const outputManifestPath = relative(target, manifestPath);
const files = [];
for (const path of (await filesUnder(target)).sort((left, right) => left.localeCompare(right))) {
  if (path === outputManifestPath) continue;
  const bytes = await readFile(join(target, path));
  const route = routeByPath.get(path);
  files.push(route === undefined
    ? { path, hash: digest(bytes), type: policyPaths.has(path) ? "policy" : "asset" }
    : { path, hash: digest(bytes), type: "route", route });
}
await writeFile(manifestPath, `${JSON.stringify({ protocol: "wikai-static-renderer", version: 1, files })}\n`);
