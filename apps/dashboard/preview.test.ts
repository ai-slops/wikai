import { expect, it } from "vitest";
import { hash } from "../../packages/fs/index.ts";
import { previewHtml } from "./preview.ts";

function artifact(path: string, mime: string, text: string) {
  const data = Buffer.from(text).toString("base64");
  return { path, mime, data, bytes: Buffer.byteLength(text), hash: hash(Buffer.from(text)) };
}

function cspDirectives(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/u);
      return [name ?? "", sources];
    }),
  );
}

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

it("builds an opaque-origin MDX document from verified public artifacts only", () => {
  // Given
  const html = artifact(
    "index.html",
    "text/html; charset=utf-8",
    '<div id="wikai-mdx-root">Count: 0</div>',
  );
  const script = artifact(
    "client.js",
    "text/javascript; charset=utf-8",
    'document.querySelector("#wikai-mdx-root").addEventListener("click",event=>{event.currentTarget.textContent="Count: 1"})',
  );
  const style = artifact("client.css", "text/css; charset=utf-8", "#wikai-mdx-root{color:green}");

  // When
  const preview = previewHtml({
    publications: [
      {
        html: "<p>fallback</p>",
        assets: [],
        mdx: {
          schemaVersion: 1,
          contentInputHash: `sha256:${"1".repeat(64)}`,
          profileDigest: `sha256:${"2".repeat(64)}`,
          runtime: {
            image: "wikai-mdx:test",
            lockHash: `sha256:${"3".repeat(64)}`,
            runtimeHash: `sha256:${"4".repeat(64)}`,
          },
          dependencies: [artifact("private-source.tsx", "text/javascript", "private sentinel")],
          artifact: { html, scripts: [script], styles: [style] },
        },
      },
    ],
  });

  // Then
  expect(preview).toContain("default-src 'none'");
  expect(preview).toContain("connect-src 'none'");
  expect(preview).toContain("form-action 'none'");
  expect(preview).toContain("worker-src 'none'");
  expect(preview).toContain(`data:text/javascript;base64,${script.data}`);
  expect(preview).toContain(`data:text/css;base64,${style.data}`);
  expect(preview).toContain("Count: 0");
  expect(preview).not.toContain("private sentinel");
  expect(preview).not.toContain("fallback");
});

it("allows MDX style attributes without weakening stylesheet or runtime isolation", () => {
  // Given
  const html = artifact("index.html", "text/html", '<div style="color: red">Preview</div>');
  const script = artifact("client.js", "text/javascript", "document.body.dataset.ready='true'");
  const style = artifact("client.css", "text/css", "body { margin: 0 }");

  // When
  const preview = previewHtml({
    publications: [
      {
        html: "",
        assets: [],
        mdx: {
          schemaVersion: 1,
          contentInputHash: `sha256:${"1".repeat(64)}`,
          profileDigest: `sha256:${"2".repeat(64)}`,
          runtime: {
            image: "wikai-mdx:test",
            lockHash: `sha256:${"3".repeat(64)}`,
            runtimeHash: `sha256:${"4".repeat(64)}`,
          },
          dependencies: [],
          artifact: { html, scripts: [script], styles: [style] },
        },
      },
    ],
  });
  const policy = preview.match(/Content-Security-Policy" content="([^"]+)"/u)?.[1] ?? "";
  const directives = cspDirectives(policy);

  // Then
  expect(directives.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
  expect(directives.get("style-src-elem")).toEqual(["data:"]);
  expect(directives.get("script-src")).toEqual(["data:"]);
  expect(directives.get("connect-src")).toEqual(["'none'"]);
  expect(directives.get("frame-src")).toEqual(["'none'"]);
  expect(directives.get("form-action")).toEqual(["'none'"]);
  expect(directives.get("worker-src")).toEqual(["'none'"]);
  expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
});

it("rejects modified MDX artifact bytes", () => {
  // Given
  const html = artifact("index.html", "text/html", "<p>trusted</p>");
  const script = artifact("client.js", "text/javascript", "document.body.dataset.ready='true'");

  // When
  const render = () =>
    previewHtml({
      publications: [
        {
          html: "",
          assets: [],
          mdx: {
            schemaVersion: 1,
            contentInputHash: `sha256:${"1".repeat(64)}`,
            profileDigest: `sha256:${"2".repeat(64)}`,
            runtime: {
              image: "wikai-mdx:test",
              lockHash: `sha256:${"3".repeat(64)}`,
              runtimeHash: `sha256:${"4".repeat(64)}`,
            },
            dependencies: [],
            artifact: {
              html: { ...html, data: Buffer.from("tampered").toString("base64") },
              scripts: [script],
              styles: [],
            },
          },
        },
      ],
    });

  // Then
  expect(render).toThrow("MDX preview artifact failed integrity verification");
});
