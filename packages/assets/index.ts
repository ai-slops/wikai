import { readFile } from "node:fs/promises";
import { extname, posix, relative, resolve, sep } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { hash, safePath } from "../fs/index.ts";
import { type MaterializedAsset, type PublisherConfig, PublisherError } from "../model/index.ts";

const AUTO_RASTER_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REVIEWED_ATTACHMENT_EXTENSIONS = new Set([
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
  ".gif",
  ".json",
  ".csv",
  ".txt",
]);
const FORBIDDEN_EXTENSIONS = new Set([
  ".svg",
  ".exe",
  ".dll",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".sh",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
]);
const FORBIDDEN_MIMES = new Set([
  "application/x-elf",
  "application/x-msdownload",
  "application/wasm",
  "image/svg+xml",
  "text/html",
]);

export class AssetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssetError";
    this.code = code;
  }
}

const withinAssetRoot = (sourcePath: string, roots: readonly string[]): boolean =>
  roots.some((root) => {
    const normalized = root.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    return sourcePath === normalized || sourcePath.startsWith(`${normalized}/`);
  });

const rasterExtensionMatches = (mime: string, extension: string): boolean => {
  if (extension === "") return true;
  switch (mime) {
    case "image/jpeg":
      return extension === ".jpg" || extension === ".jpeg";
    case "image/png":
      return extension === ".png";
    case "image/webp":
      return extension === ".webp";
    case "image/gif":
      return extension === ".gif";
    default:
      return false;
  }
};

const requireReview = (sourcePath: string, sourceHash: string, config: PublisherConfig): void => {
  if (
    !sourcePath.startsWith("public-assets/") ||
    !config.assets.reviewedHashes.includes(sourceHash)
  )
    throw new AssetError(
      "ASSET_REVIEW_REQUIRED",
      "Attachments require an explicit reviewed content hash",
    );
};

const sanitizeRaster = async (
  input: Buffer,
  mime: string,
): Promise<{ readonly data: Buffer; readonly mime: string; readonly extension: string }> => {
  try {
    const decoded = sharp(input, { animated: false, failOn: "warning" });
    switch (mime) {
      case "image/jpeg":
        return {
          data: await decoded.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
          mime,
          extension: "jpg",
        };
      case "image/png":
        return {
          data: await decoded.rotate().png({ compressionLevel: 9 }).toBuffer(),
          mime,
          extension: "png",
        };
      case "image/webp":
        return {
          data: await decoded.rotate().webp({ quality: 88 }).toBuffer(),
          mime,
          extension: "webp",
        };
      case "image/gif":
        return { data: await decoded.rotate().gif().toBuffer(), mime, extension: "gif" };
      default:
        throw new AssetError("ASSET_TYPE_FORBIDDEN", "Unsupported image type");
    }
  } catch (error) {
    if (error instanceof AssetError) throw error;
    if (error instanceof Error)
      throw new AssetError("ASSET_DECODE_FAILED", "Image could not be decoded safely");
    throw error;
  }
};

export const materializeAsset = async (
  url: string,
  sourceDocument: string,
  config: PublisherConfig,
): Promise<MaterializedAsset> => {
  if (/^(?:https?:)?\/\//iu.test(url) || url.startsWith("data:"))
    throw new AssetError("ASSET_REMOTE_FORBIDDEN", "Remote and embedded assets are forbidden");
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url.split("#", 1)[0] ?? "");
  } catch (error) {
    if (error instanceof URIError)
      throw new AssetError("ASSET_PATH_INVALID", "Asset path encoding is invalid");
    throw error;
  }
  const vaultRelative = posix.join(posix.dirname(sourceDocument), decodedUrl);
  let absolute: string;
  try {
    absolute = await safePath(config.vault.root, vaultRelative);
  } catch (error) {
    if (error instanceof PublisherError) throw new AssetError(error.code, error.message);
    throw error;
  }
  const sourcePath = relative(resolve(config.vault.root), absolute).split(sep).join("/");
  if (!withinAssetRoot(sourcePath, config.assets.roots))
    throw new AssetError("ASSET_ROOT_FORBIDDEN", "Asset is outside configured roots");
  if (FORBIDDEN_EXTENSIONS.has(extname(sourcePath).toLowerCase()))
    throw new AssetError("ASSET_TYPE_FORBIDDEN", "Executable, HTML, and SVG assets are forbidden");
  let input: Buffer;
  try {
    input = await readFile(absolute);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new AssetError("ASSET_NOT_FOUND", "Asset does not exist");
    throw error;
  }
  if (input.byteLength > config.assets.maxFileBytes)
    throw new AssetError("ASSET_TOO_LARGE", "Asset exceeds configured size limit");
  const detected = await fileTypeFromBuffer(input);
  const extension = extname(sourcePath).toLowerCase();
  const prefix = input.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  if (
    FORBIDDEN_MIMES.has(detected?.mime ?? "") ||
    prefix.startsWith("#!") ||
    prefix.startsWith("<svg") ||
    prefix.includes("<svg ") ||
    prefix.startsWith("<!doctype html") ||
    prefix.startsWith("<html")
  ) {
    throw new AssetError("ASSET_TYPE_FORBIDDEN", "Executable, HTML, and SVG assets are forbidden");
  }
  if (detected && (AUTO_RASTER_MIMES.has(detected.mime) || detected.mime === "image/gif")) {
    if (!rasterExtensionMatches(detected.mime, extension))
      throw new AssetError(
        "ASSET_EXTENSION_MISMATCH",
        "Asset extension does not match decoded image type",
      );
    if (detected.mime === "image/gif") requireReview(sourcePath, hash(input), config);
    const sanitized = await sanitizeRaster(input, detected.mime);
    const digest = hash(sanitized.data);
    return {
      publicPath: `/assets/${digest.replace("sha256:", "")}.${sanitized.extension}`,
      hash: digest,
      mime: sanitized.mime,
      bytes: sanitized.data.byteLength,
      data: sanitized.data.toString("base64"),
      reviewed: true,
    };
  }
  if (!REVIEWED_ATTACHMENT_EXTENSIONS.has(extension))
    throw new AssetError("ASSET_TYPE_FORBIDDEN", "Attachment type is not allowed");
  const digest = hash(input);
  requireReview(sourcePath, digest, config);
  const mime = detected?.mime ?? (extension === ".txt" ? "text/plain" : "application/octet-stream");
  return {
    publicPath: `/assets/${digest.replace("sha256:", "")}${extension}`,
    hash: digest,
    mime,
    bytes: input.byteLength,
    data: input.toString("base64"),
    reviewed: true,
  };
};
