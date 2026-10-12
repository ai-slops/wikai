import { hash } from "../fs/index.ts";
import { type MdxFile, type MdxSnapshot, MdxSnapshotSchema } from "../model/index.ts";
import { MdxError } from "./error.ts";
import type { MdxRuntimeOutput } from "./output.ts";

export type MdxRequestedIdentity = {
  readonly contentInputHash: string;
  readonly profileDigest: string;
  readonly image: string;
  readonly imageId: string;
  readonly sourcePath: string;
  readonly componentRoots: readonly string[];
  readonly dataRoots: readonly string[];
};

function file(path: string, data: Buffer, mime: string): MdxFile {
  return {
    path,
    hash: hash(data),
    mime,
    bytes: data.byteLength,
    data: data.toString("base64"),
  };
}

export function createMdxSnapshot(
  input: MdxRequestedIdentity & {
    readonly dependencies: readonly MdxFile[];
    readonly output: MdxRuntimeOutput;
  },
): MdxSnapshot {
  return MdxSnapshotSchema.parse({
    schemaVersion: 1,
    contentInputHash: input.contentInputHash,
    profileDigest: input.profileDigest,
    runtime: { image: input.image, imageId: input.imageId },
    identity: {
      sourcePath: input.sourcePath,
      componentRoots: input.componentRoots,
      dataRoots: input.dataRoots,
    },
    dependencies: input.dependencies,
    artifact: {
      html: file(input.output.html.path, input.output.html.data, "text/html; charset=utf-8"),
      scripts: input.output.scripts.map(({ path, data }) =>
        file(path, data, "text/javascript; charset=utf-8"),
      ),
      styles: input.output.styles.map(({ path, data }) =>
        file(path, data, "text/css; charset=utf-8"),
      ),
    },
  });
}

export function verifyMdxSnapshot(value: unknown, requested?: MdxRequestedIdentity): MdxSnapshot {
  const snapshot = MdxSnapshotSchema.parse(value);
  if (
    requested !== undefined &&
    (snapshot.contentInputHash !== requested.contentInputHash ||
      snapshot.profileDigest !== requested.profileDigest ||
      snapshot.runtime.image !== requested.image ||
      snapshot.runtime.imageId !== requested.imageId ||
      snapshot.identity?.sourcePath !== requested.sourcePath ||
      JSON.stringify(snapshot.identity.componentRoots) !==
        JSON.stringify(requested.componentRoots) ||
      JSON.stringify(snapshot.identity.dataRoots) !== JSON.stringify(requested.dataRoots))
  ) {
    throw new MdxError("MDX_ARTIFACT_INTEGRITY", "Cached MDX identity does not match the request");
  }
  const files = [
    ...snapshot.dependencies,
    snapshot.artifact.html,
    ...snapshot.artifact.scripts,
    ...snapshot.artifact.styles,
  ];
  for (const item of files) {
    const data = Buffer.from(item.data, "base64");
    if (data.byteLength !== item.bytes || hash(data) !== item.hash) {
      throw new MdxError(
        "MDX_ARTIFACT_INTEGRITY",
        "Cached MDX artifact failed integrity validation",
      );
    }
  }
  return snapshot;
}
