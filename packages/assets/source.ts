import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { extname, posix, relative, resolve, sep } from "node:path";
import { isFsError, safePath } from "../fs/index.ts";
import { type PublisherConfig, PublisherError } from "../model/index.ts";

export class AssetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssetError";
    this.code = code;
  }
}

export function assetPathFromReference(url: string, sourceDocument: string): string {
  if (/^(?:https?:)?\/\//iu.test(url) || url.startsWith("data:")) {
    throw new AssetError("ASSET_REMOTE_FORBIDDEN", "Remote and embedded assets are forbidden");
  }
  try {
    return posix
      .join(posix.dirname(sourceDocument), decodeURIComponent(url.split("#", 1)[0] ?? ""))
      .normalize("NFC");
  } catch (error) {
    if (error instanceof URIError)
      throw new AssetError("ASSET_PATH_INVALID", "Asset path encoding is invalid");
    throw error;
  }
}

export async function readAsset(
  path: string,
  config: PublisherConfig,
  maximum = config.assets.maxFileBytes,
) {
  let absolute: string;
  try {
    absolute = await safePath(config.vault.root, path);
  } catch (error) {
    if (error instanceof PublisherError) throw new AssetError(error.code, error.message);
    throw error;
  }
  const sourcePath = relative(resolve(config.vault.root), absolute).split(sep).join("/");
  const allowed = config.assets.roots.some((root) => {
    const normalized = root.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
    return sourcePath === normalized || sourcePath.startsWith(`${normalized}/`);
  });
  if (!allowed) throw new AssetError("ASSET_ROOT_FORBIDDEN", "Asset is outside configured roots");
  let handle: FileHandle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isFsError(error, "ENOENT")) throw new AssetError("ASSET_NOT_FOUND", "Asset does not exist");
    if (isFsError(error, "ELOOP"))
      throw new AssetError("ASSET_SYMLINK", "Symbolic links are forbidden");
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new AssetError("ASSET_NOT_FILE", "Asset must be a regular file");
    const limit = Math.floor(maximum);
    if (before.size > limit)
      throw new AssetError("ASSET_TOO_LARGE", "Asset exceeds configured size limit");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({
      end: limit,
      highWaterMark: 65536,
      autoClose: false,
    })) {
      if (!Buffer.isBuffer(chunk))
        throw new AssetError("ASSET_READ_FAILED", "Asset bytes could not be read");
      size += chunk.length;
      if (size > limit)
        throw new AssetError("ASSET_TOO_LARGE", "Asset exceeds configured size limit");
      chunks.push(chunk);
    }
    const after = await handle.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new AssetError("ASSET_CHANGED_DURING_READ", "Asset changed while its bytes were read");
    }
    return {
      sourcePath,
      extension: extname(sourcePath).toLowerCase(),
      input: Buffer.concat(chunks),
    };
  } finally {
    await handle.close();
  }
}
