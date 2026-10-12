import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash, isFsError } from "../fs/index.ts";
import type { MdxSnapshot, PublisherConfig } from "../model/index.ts";
import { createMdxSnapshot, type MdxRequestedIdentity, verifyMdxSnapshot } from "./artifact.ts";
import { resolveMdxImage, runMdxDocker } from "./docker.ts";
import { createMdxInput, snapshotPublicDependencies } from "./snapshot.ts";

export { MdxError } from "./error.ts";
export { compileMdxReferences } from "./references.ts";

export type MdxCompiler = (input: {
  readonly body: string;
  readonly sourcePath: string;
  readonly config: PublisherConfig;
}) => Promise<MdxSnapshot>;

export const compileMdx: MdxCompiler = async ({ body, sourcePath, config }) => {
  const image = config.mdx?.image ?? "wikai-mdx:local";
  const imageId = await resolveMdxImage(image);
  const profile = await snapshotPublicDependencies(config);
  const componentRoots = config.mdx?.componentRoots ?? ["public-components"];
  const dataRoots = config.mdx?.dataRoots ?? ["public-data"];
  const immutable = createMdxInput({
    body,
    sourcePath,
    snapshot: profile,
    image,
    imageId,
    componentRoots,
    dataRoots,
  });
  const requested: MdxRequestedIdentity = {
    contentInputHash: immutable.contentInputHash,
    profileDigest: immutable.profileDigest,
    image,
    imageId,
    sourcePath: immutable.sourcePath,
    componentRoots,
    dataRoots,
  };
  const cacheKey = hash(`${immutable.contentInputHash}\n${immutable.profileDigest}`);
  const cacheDirectory = join(config.publisher.stateDir, "mdx-cache");
  const cachePath = join(cacheDirectory, `${cacheKey.slice("sha256:".length)}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    return verifyMdxSnapshot(cached, requested);
  } catch (error) {
    if (!(error instanceof SyntaxError) && !isFsError(error, "ENOENT")) throw error;
  }
  const output = await runMdxDocker({ body, immutable });
  const snapshot = createMdxSnapshot({
    ...requested,
    dependencies: immutable.files,
    output,
  });
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(snapshot)}\n`, { flag: "wx" }).catch((error) => {
    if (!isFsError(error, "EEXIST")) throw error;
  });
  return snapshot;
};
