import { z } from "zod";

const PreviewSchema = z.object({
  publications: z.array(
    z.object({
      html: z.string(),
      assets: z
        .array(z.object({ publicPath: z.string(), mime: z.string(), data: z.string() }))
        .default([]),
    }),
  ),
});
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function previewHtml(value: unknown): string {
  const page = PreviewSchema.parse(value).publications[0];
  if (!page) return "";
  let html = page.html;
  for (const asset of page.assets) {
    if (!imageTypes.has(asset.mime) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(asset.data)) continue;
    html = html.replaceAll(
      `src="${asset.publicPath}"`,
      `src="data:${asset.mime};base64,${asset.data}"`,
    );
  }
  return html;
}
