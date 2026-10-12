import { hash } from "../fs/index.ts";
import { compileMarkdown, type LinkTarget, type VaultLinkTarget } from "../markdown/index.ts";
import { compileMdx, compileMdxReferences, type MdxCompiler } from "../mdx/index.ts";
import type { PrivateDocument, PublisherConfig, WorkingPublication } from "../model/index.ts";
import { CompilerError, exposureMetadata, metadataFor } from "./metadata.ts";
import { publicationPrivacyDiagnostics } from "./privacy.ts";
import { selfTarget } from "./targets.ts";

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/u,
  /\b(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{12,}["']/iu,
] as const;

export type CompileContext = {
  readonly config: PublisherConfig;
  readonly approved: readonly LinkTarget[];
  readonly vaultTargets: readonly VaultLinkTarget[];
  readonly mdxCompiler?: MdxCompiler;
};

const containsDeniedValue = (
  publication: Pick<WorkingPublication, "metadata" | "markdown" | "html" | "assets" | "mdx">,
  patterns: readonly string[],
): boolean => {
  const visible = `${JSON.stringify(publication.metadata)}\n${publication.markdown}\n${publication.html}`;
  const assetText = publication.assets.map((asset) =>
    Buffer.from(asset.data, "base64").toString("utf8"),
  );
  const mdxText = publication.mdx
    ? [
        ...publication.mdx.dependencies,
        publication.mdx.artifact.html,
        ...publication.mdx.artifact.scripts,
        ...publication.mdx.artifact.styles,
      ].map((file) => Buffer.from(file.data, "base64").toString("utf8"))
    : [];
  const exposedText = [...assetText, ...mdxText];
  if (
    /\bprv_[A-Za-z0-9_-]+\b/u.test(visible) ||
    exposedText.some((value) => /\bprv_[A-Za-z0-9_-]+\b/u.test(value))
  )
    return true;
  if (
    CREDENTIAL_PATTERNS.some(
      (pattern) => pattern.test(visible) || exposedText.some((value) => pattern.test(value)),
    )
  )
    return true;
  for (const pattern of patterns) {
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, "u");
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new CompilerError("SECURITY_PATTERN_INVALID", "Security deny pattern is invalid");
      throw error;
    }
    if (matcher.test(visible)) return true;
    if (exposedText.some((value) => matcher.test(value))) return true;
  }
  return false;
};

export const compileDocument = async (
  document: PrivateDocument,
  context: CompileContext,
): Promise<WorkingPublication> => {
  const spec = document.frontmatter.public;
  if (!spec) throw new CompilerError("PUBLIC_SPEC_MISSING", "Public specification is missing");
  if (!document.frontmatter.id)
    throw new CompilerError("SOURCE_ID_REQUIRED", "Publication source requires a private ID");
  if (["work", "log"].includes(spec.kind) && document.body.trim().length === 0)
    throw new CompilerError("PUBLIC_BODY_REQUIRED", "Publication body is required");
  const metadata = metadataFor(document, context.config);
  const self = selfTarget(document, metadata);
  const targets = [...context.approved.filter((target) => target.publicId !== self.publicId), self];
  const rendered =
    document.format === "mdx"
      ? await (async () => {
          const references = await compileMdxReferences({
            body: document.body,
            sourcePath: document.sourcePath,
            config: context.config,
            targets,
            vaultTargets: context.vaultTargets,
            self,
          });
          const mdx = await (context.mdxCompiler ?? compileMdx)({
            body: references.body,
            sourcePath: document.sourcePath,
            config: context.config,
          });
          return {
            kind: "mdx" as const,
            markdown: references.body,
            html: Buffer.from(mdx.artifact.html.data, "base64").toString("utf8"),
            outgoingLinks: references.outgoingLinks,
            assets: references.assets,
            mdx,
          };
        })()
      : {
          kind: "markdown" as const,
          ...(await compileMarkdown({
            body: document.body,
            sourcePath: document.sourcePath,
            config: context.config,
            targets,
            vaultTargets: context.vaultTargets,
            self,
          })),
        };
  const exposureHash = hash(
    JSON.stringify({
      metadata: exposureMetadata(metadata),
      markdown: rendered.markdown,
      html: rendered.html,
      outgoingLinks: rendered.outgoingLinks,
      assets: rendered.assets.map(({ publicPath, hash: assetHash, mime, bytes }) => ({
        publicPath,
        hash: assetHash,
        mime,
        bytes,
      })),
      ...(rendered.kind === "mdx" ? { mdx: rendered.mdx } : {}),
    }),
  );
  const publication: WorkingPublication = {
    publicId: spec.id,
    sourceId: document.frontmatter.id,
    sourcePath: document.sourcePath,
    sourceHash: document.sourceHash,
    sourceMode: spec.mode,
    workflowStatus: spec.status,
    metadata,
    markdown: rendered.markdown,
    html: rendered.html,
    outgoingLinks: [...rendered.outgoingLinks],
    assets: [...rendered.assets],
    sources: spec.sources,
    exposureHash,
    diagnostics: [],
    ...(rendered.kind === "mdx" ? { mdx: rendered.mdx } : {}),
  };
  if (containsDeniedValue(publication, context.config.security.denyPatterns))
    throw new CompilerError(
      "PUBLIC_SECRET_DETECTED",
      "Potential private data was detected in public output",
    );
  return {
    ...publication,
    diagnostics: [...publicationPrivacyDiagnostics(publication, context.config)],
  };
};
