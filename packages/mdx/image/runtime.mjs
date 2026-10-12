import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import mdx from "@mdx-js/esbuild";
import * as esbuild from "esbuild";

const inputRoot = "/input";
const outputRoot = "/output";
const entry = resolve(inputRoot, process.env.WIKAI_MDX_ENTRY ?? "document.mdx");
const roots = (process.env.WIKAI_MDX_ROOTS ?? "public-components:public-data")
  .split(":")
  .filter(Boolean)
  .map((root) => resolve(inputRoot, root));
const packages = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
]);

const inside = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);
const allowedFile = (path) => path === entry || roots.some((root) => inside(root, path));
const sandbox = {
  name: "wikai-mdx-sandbox",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (inside("/app/node_modules", args.importer)) return undefined;
      if (packages.has(args.path)) return undefined;
      if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
        return { errors: [{ text: "Package import is not allowed" }] };
      }
      const resolved = resolve(args.resolveDir || inputRoot, args.path);
      if (!allowedFile(resolved)) return { errors: [{ text: "Import is outside public roots" }] };
      return { path: resolved };
    });
  },
};

const options = {
  bundle: true,
  jsx: "automatic",
  minify: true,
  nodePaths: ["/app/node_modules"],
  plugins: [sandbox, mdx()],
  sourcemap: false,
  target: "es2022",
  write: false,
};

const client = await esbuild.build({
  ...options,
  format: "esm",
  platform: "browser",
  outfile: "/tmp/client.js",
  stdin: {
    contents: `import React from "react";import{hydrateRoot}from"react-dom/client";import Content from ${JSON.stringify(entry)};hydrateRoot(document.getElementById("wikai-mdx-root"),React.createElement(Content));`,
    loader: "js",
    resolveDir: inputRoot,
    sourcefile: "client-entry.js",
  },
});
const server = await esbuild.build({
  ...options,
  format: "cjs",
  platform: "node",
  outfile: "/tmp/server.cjs",
  stdin: {
    contents: `import React from "react";import{renderToString}from"react-dom/server";import Content from ${JSON.stringify(entry)};export default renderToString(React.createElement(Content));`,
    loader: "js",
    resolveDir: inputRoot,
    sourcefile: "server-entry.js",
  },
});

const serverFile = server.outputFiles.find((file) => extname(file.path) === ".cjs");
if (!serverFile) throw new Error("Server bundle missing");
await writeFile("/tmp/server.cjs", serverFile.contents);
const fallback = createRequire(import.meta.url)("/tmp/server.cjs").default;
await mkdir(outputRoot, { recursive: true });
await writeFile("/output/index.html", `<div id="wikai-mdx-root">${fallback}</div>`);
for (const file of client.outputFiles) {
  const extension = extname(file.path);
  const name = extension === ".css" ? "client.css" : "client.js";
  await writeFile(resolve(outputRoot, name), file.contents);
}
