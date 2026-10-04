import { scanSensitiveText } from "../audit/privacy.ts";
import type { Diagnostic, PublisherConfig, WorkingPublication } from "../model/index.ts";

export const publicationPrivacyDiagnostics = (
  publication: Pick<
    WorkingPublication,
    "publicId" | "sourcePath" | "metadata" | "markdown" | "html" | "assets"
  >,
  config: PublisherConfig,
): readonly Diagnostic[] => {
  const visible = [
    JSON.stringify(publication.metadata),
    publication.markdown,
    publication.html,
    ...publication.assets.map((asset) => Buffer.from(asset.data, "base64").toString("utf8")),
  ].join("\n");
  return scanSensitiveText(visible, {
    config: config.security,
    sourcePath: publication.sourcePath,
    publicId: publication.publicId,
  });
};
