import { extname } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { hash } from "../fs/index.ts";
import type { MaterializedAsset, PublisherConfig } from "../model/index.ts";
import { AssetError, assetPathFromReference, readAsset } from "./source.ts";

export { AssetError } from "./source.ts";

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
  const vaultRelative = assetPathFromReference(url, sourceDocument);
  if (FORBIDDEN_EXTENSIONS.has(extname(vaultRelative).toLowerCase()))
    throw new AssetError("ASSET_TYPE_FORBIDDEN", "Executable, HTML, and SVG assets are forbidden");
  const { sourcePath, input, extension } = await readAsset(vaultRelative, config);
  const detected = await fileTypeFromBuffer(input);
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
