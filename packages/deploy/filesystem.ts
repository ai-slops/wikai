import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { hash, isFsError, safePath } from "../fs/index.ts";
import type { PublisherConfig } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";

export type FingerprintEntry = {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly digest: string | null;
};

function overlaps(left: string, right: string): boolean {
  const inside = (parent: string, child: string) => {
    const delta = relative(parent, child);
    return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
  };
  return inside(left, right) || inside(right, left);
}

async function canonicalPath(path: string): Promise<string> {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (true) {
    try {
      return join(await realpath(cursor), ...missing.reverse());
    } catch (error) {
      if (!isFsError(error, "ENOENT")) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}

export async function fingerprintDirectory(root: string): Promise<readonly FingerprintEntry[]> {
  const base = resolve(root);
  let rootInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    rootInfo = await lstat(base);
  } catch (error) {
    if (isFsError(error, "ENOENT")) {
      throw new PublisherError("DEPLOYMENT_SOURCE_MISSING", "Deployment directory is missing");
    }
    throw error;
  }
  if (rootInfo.isSymbolicLink()) {
    throw new PublisherError("DEPLOYMENT_SYMLINK", "Deployment directories cannot be symlinks");
  }
  if (!rootInfo.isDirectory()) {
    throw new PublisherError("DEPLOYMENT_INVALID_DIRECTORY", "Deployment path must be a directory");
  }
  const entries: FingerprintEntry[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(base, path).split(sep).join("/");
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new PublisherError("DEPLOYMENT_SYMLINK", "Deployment trees cannot contain symlinks");
      }
      if (info.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory", digest: null });
        await visit(path);
      } else if (info.isFile()) {
        entries.push({ path: relativePath, kind: "file", digest: hash(await readFile(path)) });
      } else {
        throw new PublisherError(
          "DEPLOYMENT_INVALID_ENTRY",
          "Deployment trees may contain only regular files and directories",
        );
      }
    }
  };
  await visit(base);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function assertSafeDestination(
  config: PublisherConfig,
  destination: string,
): Promise<void> {
  await safePath(parse(destination).root, destination);
  const protectedRoots = [
    config.vault.root,
    config.publisher.stateDir,
    config.publisher.previewStagingDir,
    config.publisher.releaseStagingDir,
    config.site.sourceDir,
    config.site.distDir,
    ...config.publicViews.roots,
    ...config.assets.roots,
  ];
  const canonicalDestination = await canonicalPath(destination);
  const canonicalProtectedRoots = await Promise.all(protectedRoots.map(canonicalPath));
  if (canonicalProtectedRoots.some((root) => overlaps(canonicalDestination, root))) {
    throw new PublisherError(
      "UNSAFE_DEPLOYMENT_PATH",
      "Deployment destination must be separate from private and build roots",
    );
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isFsError(error, "ENOENT")) return false;
    throw error;
  }
}
