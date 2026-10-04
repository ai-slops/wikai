import { basename, extname, isAbsolute } from "node:path";
import { inspectBytes } from "../assets/inspection/run.ts";
import { INSPECTION_LIMITS, InspectionFormatSchema } from "../assets/inspection/schema.ts";
import { AssetError, assetPathFromReference, readAsset } from "../assets/source.ts";
import { scanSensitiveText } from "../audit/privacy.ts";
import { hash } from "../fs/index.ts";
import { collectAssetReferences } from "../markdown/asset-references.ts";
import { MarkdownError } from "../markdown/link-resolver.ts";
import { type Diagnostic, type PublisherConfig, PublisherError } from "../model/index.ts";
import { loadVault } from "../vault/index.ts";

export async function inspectAsset(path: string, config: PublisherConfig) {
  if (isAbsolute(path))
    throw new PublisherError("ASSET_PATH_INVALID", "Inspection requires a vault-relative path");
  const format = InspectionFormatSchema.safeParse(
    path.toLowerCase().endsWith(".tar.gz") ? ".tar.gz" : extname(path).toLowerCase(),
  );
  if (!format.success)
    throw new PublisherError(
      "ASSET_INSPECTION_UNSUPPORTED",
      "Inspection supports PDF, ZIP, TAR, GZIP, MP3, WAV, MP4 and WebM files",
    );
  let asset: Awaited<ReturnType<typeof readAsset>>;
  try {
    asset = await readAsset(
      path,
      config,
      Math.min(config.assets.maxFileBytes, INSPECTION_LIMITS.inputBytes),
    );
  } catch (error) {
    if (error instanceof AssetError) throw new PublisherError(error.code, error.message);
    throw error;
  }
  const sha256 = hash(asset.input);
  const inspection = await inspectBytes(asset.input, format.data);
  const diagnostics: Diagnostic[] = [];
  if (!inspection.ok) {
    diagnostics.push({
      code: inspection.code,
      severity: "error",
      message:
        "Attachment inspection failed, is unsupported here, or exceeded its safety limits; no approval was granted.",
    });
  } else {
    diagnostics.push(
      ...scanSensitiveText(JSON.stringify(inspection.metadata), {
        config: config.security,
        sourcePath: asset.sourcePath,
      }),
    );
  }
  const vault = await loadVault(config);
  let referencesComplete = vault.diagnostics.length === 0;
  const referringCandidateDocuments: { publicId: string; sourcePath: string }[] = [];
  for (const document of vault.documents) {
    const spec = document.frontmatter.public;
    if (spec === undefined) continue;
    try {
      const references = collectAssetReferences(
        document.body,
        document.sourcePath,
        config.assets.roots,
      );
      let refers = false;
      for (const url of references) {
        try {
          if (assetPathFromReference(url, document.sourcePath) === asset.sourcePath) refers = true;
        } catch (error) {
          if (!(error instanceof AssetError)) throw error;
          referencesComplete = false;
        }
      }
      if (refers)
        referringCandidateDocuments.push({ publicId: spec.id, sourcePath: document.sourcePath });
    } catch (error) {
      if (!(error instanceof MarkdownError)) throw error;
      referencesComplete = false;
    }
  }
  if (!referencesComplete) {
    diagnostics.push({
      code: "ASSET_REFERENCES_INCOMPLETE",
      severity: "warning",
      message:
        "Some source references could not be inventoried. Run validate for private diagnostics.",
    });
  }
  const underPublicAssets = asset.sourcePath.startsWith("public-assets/");
  const hashReviewed = config.assets.reviewedHashes.includes(sha256);
  return {
    sourcePath: asset.sourcePath,
    originalName: basename(asset.sourcePath),
    prospectivePublicPath: `/assets/${sha256.slice(7)}${asset.extension}`,
    sha256,
    bytes: asset.input.length,
    detectedMime: inspection.ok ? inspection.detectedMime : null,
    underPublicAssets,
    hashReviewed,
    reviewBlockers: underPublicAssets && hashReviewed ? [] : ["ASSET_REVIEW_REQUIRED"],
    inspection,
    referringCandidateDocuments,
    referencesComplete,
    diagnostics,
  };
}
