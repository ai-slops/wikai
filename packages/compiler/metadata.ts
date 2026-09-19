import GithubSlugger from "github-slugger";
import {
  MetadataSchema,
  type PrivateDocument,
  type PublicMetadata,
  type PublicSpec,
  type PublisherConfig,
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
  if (!normalized.startsWith("/") || (normalized.length > 1 && normalized.endsWith("/")))
    throw new CompilerError("PUBLIC_SLUG_INVALID", "Public path is not canonical");
  const forbidden = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 || ["?", "#", "\\"].includes(character);
  });
  if (forbidden || /%2f|%5c/iu.test(normalized))
    throw new CompilerError("PUBLIC_SLUG_INVALID", "Public path contains a forbidden character");
  try {
    const segments = normalized.slice(1).split("/");
    if (
      normalized !== "/" &&
      segments.some(
        (segment) => segment.length === 0 || [".", ".."].includes(decodeURIComponent(segment)),
      )
    )
      throw new CompilerError("PUBLIC_SLUG_INVALID", "Public path contains an unsafe segment");
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    if (error instanceof URIError)
      throw new CompilerError("PUBLIC_SLUG_INVALID", "Public path encoding is invalid");
    throw error;
  }
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

const requireKindMetadata = (spec: PublicSpec): void => {
  switch (spec.kind) {
    case "work":
      if (!spec.work?.projectStatus)
        throw new CompilerError(
          "PUBLIC_KIND_METADATA_REQUIRED",
          "Work publications require project status metadata",
        );
      return;
    case "knowledge":
      if (!spec.knowledge?.documentType)
        throw new CompilerError(
          "PUBLIC_KIND_METADATA_REQUIRED",
          "Knowledge publications require document type metadata",
        );
      return;
    case "log":
      if (!spec.log?.occurredAt)
        throw new CompilerError(
          "PUBLIC_KIND_METADATA_REQUIRED",
          "Log publications require occurrence metadata",
        );
      return;
    case "page":
      if (!spec.page?.layout)
        throw new CompilerError(
          "PUBLIC_KIND_METADATA_REQUIRED",
          "Page publications require layout metadata",
        );
      return;
    default:
      unreachableKind(spec.kind);
  }
};

export const metadataFor = (document: PrivateDocument, config: PublisherConfig): PublicMetadata => {
  const spec = document.frontmatter.public;
  if (!spec) throw new CompilerError("PUBLIC_SPEC_MISSING", "Public specification is missing");
  const title = spec.title ?? document.frontmatter.title ?? document.headings[0]?.title;
  if (!title) throw new CompilerError("PUBLIC_TITLE_MISSING", "Public title is required");
  requireKindMetadata(spec);
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
    slug: slugFor(title, spec),
    title,
    summary: spec.summary,
    tags: spec.tags,
    aliases: spec.aliases.map(validatePublicPath),
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
