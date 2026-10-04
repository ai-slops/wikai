import GithubSlugger from "github-slugger";
import {
  isCanonicalPublicRoute,
  isFixedPageRoute,
  isRendererRoute,
  MetadataSchema,
  type PrivateDocument,
  type PublicMetadata,
  type PublicSpec,
  type PublisherConfig,
  routeMatchesKind,
} from "../model/index.ts";

export class CompilerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CompilerError";
    this.code = code;
  }
}

const unreachableKind = (_kind: never): never => {
  throw new CompilerError("PUBLIC_KIND_UNKNOWN", "Publication kind is unsupported");
};

export const validatePublicPath = (value: string): string => {
  const normalized = value.normalize("NFC");
  if (!isCanonicalPublicRoute(normalized))
    throw new CompilerError("PUBLIC_SLUG_INVALID", "Public path is not canonical");
  return normalized;
};

const slugFor = (title: string, spec: PublicSpec): string => {
  if (spec.slug) return validatePublicPath(spec.slug);
  if (spec.kind === "page" && spec.page?.layout === "home") return "/";
  const segment = new GithubSlugger().slug(title);
  if (!segment)
    throw new CompilerError("PUBLIC_SLUG_INVALID", "Title cannot produce a public path");
  return validatePublicPath(spec.kind === "page" ? `/${segment}` : `/${spec.kind}/${segment}`);
};

const validatePublicUrl = (value: string, allowPublicPath = false): string => {
  if (allowPublicPath && value.startsWith("/")) return validatePublicPath(value);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    if (error instanceof TypeError)
      throw new CompilerError("PUBLIC_URL_INVALID", "Public URL is invalid");
    throw error;
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  )
    throw new CompilerError("PUBLIC_URL_INVALID", "Public URL is invalid");
  return value;
};

const requireValue = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

const requireAuthoringMetadata = (document: PrivateDocument, spec: PublicSpec): void => {
  if (spec.slug !== undefined && !requireValue(spec.slug))
    throw new CompilerError("PUBLIC_METADATA_REQUIRED", "Public slug must not be empty");
  switch (spec.kind) {
    case "work":
      if (
        !requireValue(spec.title ?? document.frontmatter.title ?? document.headings[0]?.title) ||
        !requireValue(spec.summary) ||
        !requireValue(spec.work?.role) ||
        !spec.work?.projectStatus
      )
        throw new CompilerError(
          "PUBLIC_METADATA_REQUIRED",
          "Work publications require title, summary, role and project status",
        );
      return;
    case "knowledge":
      if (
        !requireValue(spec.title ?? document.frontmatter.title ?? document.headings[0]?.title) ||
        !requireValue(spec.summary) ||
        !spec.knowledge?.documentType ||
        !spec.contentState
      )
        throw new CompilerError(
          "PUBLIC_METADATA_REQUIRED",
          "Knowledge publications require title, summary, document type and content state",
        );
      return;
    case "log":
      if (!spec.log?.occurredAt)
        throw new CompilerError(
          "PUBLIC_METADATA_REQUIRED",
          "Log publications require occurrence metadata",
        );
      return;
    case "page":
      if (
        !requireValue(spec.title ?? document.frontmatter.title ?? document.headings[0]?.title) ||
        !spec.page?.layout
      )
        throw new CompilerError(
          "PUBLIC_METADATA_REQUIRED",
          "Page publications require title and layout",
        );
      return;
    default:
      unreachableKind(spec.kind);
  }
};

export const metadataFor = (document: PrivateDocument, config: PublisherConfig): PublicMetadata => {
  const spec = document.frontmatter.public;
  if (!spec) throw new CompilerError("PUBLIC_SPEC_MISSING", "Public specification is missing");
  requireAuthoringMetadata(document, spec);
  const title =
    spec.title ??
    document.frontmatter.title ??
    document.headings[0]?.title ??
    (spec.kind === "log" ? spec.log?.occurredAt : undefined);
  if (!title) throw new CompilerError("PUBLIC_TITLE_MISSING", "Public title is required");
  const slug = slugFor(title, spec);
  if (isRendererRoute(slug))
    throw new CompilerError("PUBLIC_ROUTE_RESERVED", "Public path is owned by the renderer");
  if (!routeMatchesKind(slug, spec.kind, spec.page?.layout))
    throw new CompilerError(
      "PUBLIC_ROUTE_KIND_MISMATCH",
      "Public path does not match its content kind or page layout",
    );
  const aliases = spec.aliases.map(validatePublicPath);
  if (aliases.some((alias) => isRendererRoute(alias) || isFixedPageRoute(alias)))
    throw new CompilerError("PUBLIC_ROUTE_RESERVED", "Public alias is reserved");
  const defaults = config.defaults[spec.kind];
  const work = spec.work
    ? {
        ...spec.work,
        ...(spec.work.links
          ? {
              links: spec.work.links.map((link) => ({
                ...link,
                url: validatePublicUrl(link.url),
              })),
            }
          : {}),
      }
    : undefined;
  const parsed = MetadataSchema.safeParse({
    id: spec.id,
    kind: spec.kind,
    slug,
    title,
    summary: spec.summary,
    tags: spec.tags,
    aliases,
    listed: spec.listed ?? defaults.listed,
    index: spec.index ?? defaults.index,
    feed: spec.feed ?? defaults.feed,
    featured: spec.featured,
    contentState: spec.contentState,
    canonical: spec.canonical ? validatePublicUrl(spec.canonical, true) : undefined,
    work: spec.kind === "work" ? work : undefined,
    knowledge: spec.kind === "knowledge" ? spec.knowledge : undefined,
    log: spec.kind === "log" ? spec.log : undefined,
    page: spec.kind === "page" ? spec.page : undefined,
  });
  if (!parsed.success)
    throw new CompilerError("PUBLIC_METADATA_INVALID", "Public metadata is invalid");
  return parsed.data;
};

export const exposureMetadata = (metadata: PublicMetadata): Record<string, unknown> => {
  const {
    publishedAt: _publishedAt,
    updatedAt: _updatedAt,
    lastReviewedAt: _lastReviewedAt,
    lastVerifiedAt: _lastVerifiedAt,
    ...stable
  } = metadata;
  return stable;
};
