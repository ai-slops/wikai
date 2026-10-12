import { createHash } from "node:crypto";
import { z } from "zod";
import { MdxSnapshotSchema } from "../../packages/model/index.ts";

const PreviewSchema = z.object({
  publications: z.array(
    z.object({
      html: z.string(),
      assets: z
        .array(z.object({ publicPath: z.string(), mime: z.string(), data: z.string() }))
        .default([]),
      mdx: MdxSnapshotSchema.optional(),
    }),
  ),
});
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const artifactTypes = {
  html: new Set(["text/html"]),
  script: new Set(["text/javascript", "application/javascript"]),
  style: new Set(["text/css"]),
} as const;

function verifiedData(
  artifact: z.infer<typeof MdxSnapshotSchema>["artifact"]["html"],
  allowedTypes: ReadonlySet<string>,
): string {
  const mime = artifact.mime.split(";", 1)[0]?.trim();
  if (
    mime === undefined ||
    !allowedTypes.has(mime) ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(artifact.data)
  ) {
    throw new TypeError("MDX preview artifact type is not allowed");
  }
  const bytes = Buffer.from(artifact.data, "base64");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== artifact.bytes || digest !== artifact.hash) {
    throw new TypeError("MDX preview artifact failed integrity verification");
  }
  return artifact.data;
}

function inlineImages(
  html: string,
  assets: readonly { readonly publicPath: string; readonly mime: string; readonly data: string }[],
): string {
  let result = html;
  for (const asset of assets) {
    if (!imageTypes.has(asset.mime) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(asset.data)) continue;
    result = result.replaceAll(
      `src="${asset.publicPath}"`,
      `src="data:${asset.mime};base64,${asset.data}"`,
    );
  }
  return result;
}

function mdxDocument(
  mdx: z.infer<typeof MdxSnapshotSchema>,
  assets: readonly { readonly publicPath: string; readonly mime: string; readonly data: string }[],
): string {
  const htmlData = verifiedData(mdx.artifact.html, artifactTypes.html);
  const html = inlineImages(Buffer.from(htmlData, "base64").toString("utf8"), assets);
  const styles = mdx.artifact.styles
    .map(
      (style) =>
        `<link rel="stylesheet" href="data:text/css;base64,${verifiedData(style, artifactTypes.style)}">`,
    )
    .join("");
  const scripts = mdx.artifact.scripts
    .map(
      (script) =>
        `<script type="module" src="data:text/javascript;base64,${verifiedData(script, artifactTypes.script)}"></script>`,
    )
    .join("");
  const policy = [
    "default-src 'none'",
    "script-src data:",
    "style-src-elem data:",
    "style-src-attr 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${styles}</head><body>${html}${scripts}</body></html>`;
}

export function previewHtml(value: unknown): string {
  const page = PreviewSchema.parse(value).publications[0];
  if (!page) return "";
  if (page.mdx !== undefined) return mdxDocument(page.mdx, page.assets);
  return inlineImages(page.html, page.assets);
}
