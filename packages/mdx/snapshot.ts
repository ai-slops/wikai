import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, posix, resolve } from "node:path";
import { hash, isFsError, safePath } from "../fs/index.ts";
import type { MdxFile, PublisherConfig } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";

const ALLOWED_EXTENSIONS = new Set([".css", ".js", ".json", ".jsx", ".mjs", ".ts", ".tsx"]);
export type MdxDependencySnapshot = {
  readonly files: readonly MdxFile[];
};

export type MdxImmutableInput = MdxDependencySnapshot & {
  readonly contentInputHash: string;
  readonly profileDigest: string;
  readonly sourcePath: string;
  readonly image: string;
  readonly imageId: string;
  readonly componentRoots: readonly string[];
  readonly dataRoots: readonly string[];
};

function mime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json";
    default:
      return "text/javascript; charset=utf-8";
  }
}

async function rootFiles(vaultRoot: string, root: string): Promise<readonly string[]> {
  const absoluteRoot = await safePath(vaultRoot, root);
  const paths: string[] = [];
  const walk = async (directory: string, relative: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isFsError(error, "ENOENT")) return;
      throw error;
    }
    for (const entry of entries) {
      const logical = posix.join(relative, entry.name);
      const absolute = resolve(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new PublisherError(
          "MDX_DEPENDENCY_SYMLINK",
          "MDX public dependencies cannot be symlinks",
        );
      }
      if (stat.isDirectory()) await walk(absolute, logical);
      else if (stat.isFile()) {
        if (!ALLOWED_EXTENSIONS.has(extname(logical).toLowerCase())) {
          throw new PublisherError(
            "MDX_DEPENDENCY_TYPE_FORBIDDEN",
            "MDX public dependency type is not allowed",
          );
        }
        paths.push(logical);
      }
    }
  };
  await walk(absoluteRoot, root);
  return paths;
}

export async function snapshotPublicDependencies(
  config: PublisherConfig,
): Promise<MdxDependencySnapshot> {
  const mdx = config.mdx ?? {
    enabled: false,
    componentRoots: ["public-components"],
    dataRoots: ["public-data"],
    image: "wikai-mdx:local",
    maxProfileBytes: 5 * 1024 * 1024,
  };
  const roots = [...mdx.componentRoots, ...mdx.dataRoots];
  const paths = (await Promise.all(roots.map((root) => rootFiles(config.vault.root, root))))
    .flat()
    .sort((left, right) => left.localeCompare(right));
  const files: MdxFile[] = [];
  let total = 0;
  for (const path of paths) {
    const data = await readFile(await safePath(config.vault.root, path));
    total += data.byteLength;
    if (total > mdx.maxProfileBytes) {
      throw new PublisherError(
        "MDX_PROFILE_TOO_LARGE",
        "MDX public dependencies exceed the size limit",
      );
    }
    files.push({
      path,
      hash: hash(data),
      mime: mime(path),
      bytes: data.byteLength,
      data: data.toString("base64"),
    });
  }
  return { files };
}

export function createMdxInput(input: {
  readonly body: string;
  readonly sourcePath: string;
  readonly snapshot: MdxDependencySnapshot;
  readonly image: string;
  readonly imageId: string;
  readonly componentRoots: readonly string[];
  readonly dataRoots: readonly string[];
}): MdxImmutableInput {
  const sourcePath = posix.normalize(input.sourcePath.replaceAll("\\", "/"));
  if (posix.isAbsolute(sourcePath) || sourcePath === ".." || sourcePath.startsWith("../")) {
    throw new PublisherError(
      "MDX_SOURCE_PATH_INVALID",
      "MDX source path must stay inside the vault",
    );
  }
  const contentInputHash = hash(JSON.stringify({ body: input.body, sourcePath }));
  const profileDigest = hash(
    JSON.stringify({
      image: input.image,
      imageId: input.imageId,
      componentRoots: input.componentRoots,
      dataRoots: input.dataRoots,
      files: input.snapshot.files.map(({ path, hash: fileHash, bytes }) => ({
        path,
        hash: fileHash,
        bytes,
      })),
    }),
  );
  return {
    ...input.snapshot,
    contentInputHash,
    profileDigest,
    sourcePath,
    image: input.image,
    imageId: input.imageId,
    componentRoots: [...input.componentRoots],
    dataRoots: [...input.dataRoots],
  };
}
