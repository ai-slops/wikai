import { createHash, randomUUID } from "node:crypto";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { PublisherError } from "../model/index.ts";

export function hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function isFsError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isFsError(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function safePath(root: string, input: string): Promise<string> {
  const normalized = input.normalize("NFC").replaceAll("\\", "/");
  if (
    [...normalized].some((character) => character.charCodeAt(0) < 32) ||
    normalized.split("/").includes("..")
  ) {
    throw new PublisherError("ASSET_PATH_TRAVERSAL", "Path traversal is forbidden.");
  }
  const base = resolve(root);
  const target = resolve(base, normalized);
  const child = relative(base, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new PublisherError("ASSET_OUTSIDE_ROOT", "Path must remain inside its allowed root.");
  }
  const parts = target.split(sep).filter(Boolean);
  let cursor: string = sep;
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new PublisherError("ASSET_SYMLINK", "Symbolic links are forbidden.");
    } catch (error) {
      if (isFsError(error, "ENOENT")) break;
      throw error;
    }
  }
  const actualBase = await realpath(base);
  if (actualBase !== base)
    throw new PublisherError("ASSET_SYMLINK", "The allowed root must not contain symbolic links.");
  return target;
}

export async function atomicWrite(
  path: string,
  content: string | Buffer,
  expectedHash?: string,
): Promise<void> {
  const destination = resolve(path);
  await safePath(parse(destination).root, destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await safePath(dirname(destination), destination);
  const check = async () => {
    if (expectedHash === undefined) return;
    const current = await readOptional(destination);
    if (current === undefined || hash(current) !== expectedHash) {
      throw new PublisherError(
        "CONCURRENT_SOURCE_MODIFICATION",
        "The source changed; review it again before saving.",
      );
    }
  };
  await check();
  const temp = `${destination}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await check();
    await rename(temp, destination);
    const directory = await open(dirname(destination), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle.close();
    await rm(temp, { force: true });
  }
}

export async function withLock<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
  await safePath(parse(resolve(stateDir)).root, resolve(stateDir));
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await safePath(stateDir, ".");
  const lock = join(stateDir, "lock");
  let handle: FileHandle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch (error) {
    if (isFsError(error, "EEXIST"))
      throw new PublisherError(
        "PUBLICATION_LOCKED",
        "Another publication operation holds the lock.",
      );
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await action();
  } finally {
    await handle.close();
    await rm(lock);
  }
}

export async function replaceDirectory(temp: string, target: string): Promise<void> {
  const staging = await safePath(parse(resolve(temp)).root, resolve(temp));
  const destination = await safePath(parse(resolve(target)).root, resolve(target));
  if (!(await lstat(staging)).isDirectory())
    throw new PublisherError("INVALID_STAGING", "Staging must be a real directory.");
  const delta = relative(staging, destination);
  const reverse = relative(destination, staging);
  if (delta === "" || !delta.startsWith(`..${sep}`) || !reverse.startsWith(`..${sep}`)) {
    throw new PublisherError(
      "UNSAFE_OUTPUT_PATH",
      "Staging and target directories must not overlap.",
    );
  }
  const previous = `${destination}.previous`;
  await safePath(parse(previous).root, previous);
  let moved = false;
  try {
    await lstat(destination);
  } catch (error) {
    if (!isFsError(error, "ENOENT")) throw error;
    try {
      await rename(previous, destination);
    } catch (recoveryError) {
      if (!isFsError(recoveryError, "ENOENT")) throw recoveryError;
    }
  }
  await rm(previous, { recursive: true, force: true });
  try {
    await rename(destination, previous);
    moved = true;
  } catch (error) {
    if (!isFsError(error, "ENOENT")) throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (moved) await rename(previous, destination);
    throw error;
  }
  const directory = await open(dirname(destination), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
