import { defineConfig } from "astro/config";
import { resolve } from "node:path";

const outDir = process.env.WIKAI_RENDER_DIR ?? process.env.WIKAI_OUT_DIR ?? "./dist";
const cacheDir = resolve(process.env.WIKAI_CACHE_DIR ?? "./node_modules/.astro");
const site = process.env.WIKAI_SITE_URL ?? "https://example.invalid";

export default defineConfig({
  output: "static",
  outDir,
  cacheDir,
  site,
  build: { format: "directory", assets: "_assets" },
  vite: { cacheDir: process.env.WIKAI_VITE_CACHE_DIR ?? "node_modules/.vite", build: { sourcemap: false } },
});
