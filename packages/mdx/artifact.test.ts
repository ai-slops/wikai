import { expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { MdxSnapshotSchema } from "../model/index.ts";
import { createMdxSnapshot, verifyMdxSnapshot } from "./artifact.ts";

const digest = (value: string): string => `sha256:${value.repeat(64)}`;

function output() {
  return {
    html: { path: "index.html", data: Buffer.from('<div id="wikai-mdx-root">Counter</div>') },
    scripts: [{ path: "client.js", data: Buffer.from("export {};\n") }],
    styles: [],
  };
}

it("accepts legacy version-one snapshots without new identity evidence", () => {
  // Given a valid snapshot written before resolved image and compile identity fields existed.
  const html = Buffer.from('<div id="wikai-mdx-root">Counter</div>');
  const script = Buffer.from("export {};\n");
  const legacy = {
    schemaVersion: 1,
    contentInputHash: digest("1"),
    profileDigest: digest("2"),
    runtime: { image: "wikai-mdx:local", lockHash: digest("3"), runtimeHash: digest("4") },
    dependencies: [],
    artifact: {
      html: {
        path: "index.html",
        hash: hash(html),
        mime: "text/html; charset=utf-8",
        bytes: html.byteLength,
        data: html.toString("base64"),
      },
      scripts: [
        {
          path: "client.js",
          hash: hash(script),
          mime: "text/javascript; charset=utf-8",
          bytes: script.byteLength,
          data: script.toString("base64"),
        },
      ],
      styles: [],
    },
  };

  // When the current schema reads the approved historical snapshot.
  const parsed = MdxSnapshotSchema.parse(legacy);

  // Then its original runtime evidence remains readable without rewriting bytes.
  expect(parsed).toEqual(legacy);
});

it("rejects a cache entry whose requested identity fields do not match", () => {
  // Given an intact cached artifact carrying identity for a different source path.
  const snapshot = createMdxSnapshot({
    contentInputHash: digest("5"),
    profileDigest: digest("6"),
    image: "wikai-mdx:local",
    imageId: digest("7"),
    sourcePath: "archive/counter.mdx",
    componentRoots: ["public-components"],
    dataRoots: ["public-data"],
    dependencies: [],
    output: output(),
  });

  // When cache ingestion requests the same hashes but the current normalized entry path.
  const action = () =>
    verifyMdxSnapshot(snapshot, {
      contentInputHash: digest("5"),
      profileDigest: digest("6"),
      image: "wikai-mdx:local",
      imageId: digest("7"),
      sourcePath: "notes/counter.mdx",
      componentRoots: ["public-components"],
      dataRoots: ["public-data"],
    });

  // Then per-file hashes alone cannot satisfy the cache request.
  expect(action).toThrow(expect.objectContaining({ code: "MDX_ARTIFACT_INTEGRITY" }));
});
