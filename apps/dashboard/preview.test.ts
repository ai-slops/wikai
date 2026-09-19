import { expect, it } from "vitest";
import { previewHtml } from "./preview.ts";

it("renders only referenced sanitized snapshot image bytes in the private preview", () => {
  const html = previewHtml({
    publications: [
      {
        html: '<p><img src="/assets/image.png" alt="Diagram"></p>',
        assets: [{ publicPath: "/assets/image.png", mime: "image/png", data: "YWJj" }],
      },
    ],
  });
  expect(html).toContain('src="data:image/png;base64,YWJj"');
  expect(html).toContain('alt="Diagram"');
});

it("does not inline active-content attachments as preview images", () => {
  expect(
    previewHtml({
      publications: [
        {
          html: '<img src="/assets/image.svg">',
          assets: [{ publicPath: "/assets/image.svg", mime: "image/svg+xml", data: "YWJj" }],
        },
      ],
    }),
  ).not.toContain("data:");
});
