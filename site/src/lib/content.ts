import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const KindSchema = z.enum(["work", "knowledge", "log", "page"]);
const AbsolutePathSchema = z.string().superRefine((path, context) => {
  const decodedSegments = path.split("/").map((segment) => { try { return decodeURIComponent(segment); } catch { return ".."; } });
  if (!path.startsWith("/") || (path !== "/" && path.endsWith("/")) || path.includes("//") || /[?#\\\u0000-\u001f\u007f]/u.test(path) || decodedSegments.some((segment) => segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) || path !== path.normalize("NFC")) context.addIssue({ code: "custom", message: "Expected a canonical absolute public path" });
});
const LinkSchema = z.object({ publicId: z.string(), slug: z.string(), title: z.string(), anchor: z.string().optional() }).strict();
const AssetSchema = z.object({ publicPath: z.string(), hash: z.string(), mime: z.string(), bytes: z.number(), reviewed: z.boolean() }).strict();
const RendererAssetSchema = AssetSchema.omit({ reviewed: true });
const MetadataSchema = z.object({
  id: z.string().regex(/^pub_[A-Za-z0-9_-]+$/),
  kind: KindSchema,
  slug: AbsolutePathSchema,
  title: z.string().min(1),
  summary: z.string().optional(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  listed: z.boolean(),
  index: z.boolean(),
  feed: z.boolean(),
  featured: z.boolean(),
  contentState: z.enum(["draft", "active", "stable", "needs-review", "deprecated", "archived"]).optional(),
  canonical: z.url().optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  work: z.object({ role: z.string().optional(), projectStatus: z.enum(["active", "completed", "paused", "archived"]).optional(), startedAt: z.string().optional(), endedAt: z.string().optional(), links: z.array(z.object({ label: z.string(), url: z.url(), type: z.enum(["repository", "demo", "documentation", "article", "other"]).optional() }).strict()).optional() }).strict().optional(),
  knowledge: z.object({ documentType: z.enum(["topic", "guide", "design", "research", "decision", "reference"]).optional(), lastVerifiedAt: z.string().optional() }).strict().optional(),
  log: z.object({ occurredAt: z.string() }).strict().optional(),
  page: z.object({ layout: z.enum(["home", "about", "now", "contact", "generic"]).optional(), order: z.number().optional() }).strict().optional(),
}).strict();
const PageSchema = z.object({ metadata: MetadataSchema, markdown: z.string(), html: z.string(), outgoingLinks: z.array(LinkSchema), backlinks: z.array(LinkSchema), assets: z.array(AssetSchema) }).strict();
const ContentIndexSchema = z.object({ schemaVersion: z.literal(1), pages: z.array(PageSchema) }).strict();
const RedirectSchema = z.object({ from: AbsolutePathSchema, to: AbsolutePathSchema, status: z.literal(301) }).strict();
const RedirectIndexSchema = z.object({ schemaVersion: z.literal(1), redirects: z.array(RedirectSchema) }).strict();
const FileDescriptorSchema = z.object({ artifactPath: z.string(), hash: z.string(), mime: z.string(), bytes: z.number() }).strict();
const PublicFileDescriptorSchema = FileDescriptorSchema.extend({ publicPath: AbsolutePathSchema });
const RendererPageSchema = z.object({
  metadata: MetadataSchema,
  content: z.discriminatedUnion("type", [
    z.object({ type: z.literal("markdown"), markdown: z.string(), html: z.string() }).strict(),
    z.object({
      type: z.literal("mdx"),
      runtime: z.literal("react-19"),
      markdown: z.string(),
      fallbackHtml: z.string(),
      html: FileDescriptorSchema,
      scripts: z.array(PublicFileDescriptorSchema).min(1),
      styles: z.array(PublicFileDescriptorSchema),
    }).strict(),
  ]),
  outgoingLinks: z.array(LinkSchema),
  backlinks: z.array(LinkSchema),
  assets: z.array(RendererAssetSchema),
}).strict();
const RendererInputSchema = z.object({
  protocol: z.literal("wikai-static-renderer"),
  version: z.literal(1),
  siteUrl: z.url(),
  pages: z.array(RendererPageSchema),
  redirects: z.array(RedirectSchema),
  assets: z.array(RendererAssetSchema),
  tagTree: z.array(z.unknown()),
}).strict();

export type PublicPage = z.infer<typeof PageSchema> & Readonly<{
  runtime?: Readonly<{ type: "react-19"; scripts: readonly string[]; styles: readonly string[] }>;
}>;
export type PublicKind = z.infer<typeof KindSchema>;
export type PublicRedirect = z.infer<typeof RedirectSchema>;
export type PublicContent = Readonly<{ schemaVersion: 1; pages: readonly PublicPage[]; redirects: readonly PublicRedirect[] }>;
export type FeedKind = "all" | "work" | "knowledge" | "log";
export type TocItem = Readonly<{ depth: number; id: string; text: string }>;
export type ArticlePresentation = Readonly<{
  html: string;
  headingId?: string;
  embeddedHeading: boolean;
  toc: readonly TocItem[];
}>;

const stagingRoot = (): string => process.env.WIKAI_STAGING_DIR ?? "./staging";

export const loadContent = async (root = stagingRoot()): Promise<PublicContent> => {
  try {
    const input = RendererInputSchema.parse(JSON.parse(await readFile(join(root, "renderer-input.json"), "utf8")));
    return {
      schemaVersion: 1,
      pages: input.pages.map((page) => ({
        metadata: page.metadata,
        markdown: page.content.markdown,
        html: page.content.type === "mdx" ? page.content.fallbackHtml : page.content.html,
        outgoingLinks: page.outgoingLinks,
        backlinks: page.backlinks,
        assets: page.assets.map((asset) => ({ ...asset, reviewed: true })),
        ...(page.content.type === "mdx" ? {
          runtime: {
            type: "react-19" as const,
            scripts: page.content.scripts.map(({ publicPath }) => publicPath),
            styles: page.content.styles.map(({ publicPath }) => publicPath),
          },
        } : {}),
      })),
      redirects: input.redirects,
    };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const [contentText, redirectText] = await Promise.all([
    readFile(join(root, "content-index.json"), "utf8"),
    readFile(join(root, "redirects.json"), "utf8"),
  ]);
  const content = ContentIndexSchema.parse(JSON.parse(contentText));
  const redirects = RedirectIndexSchema.parse(JSON.parse(redirectText));
  return { schemaVersion: 1, pages: content.pages, redirects: redirects.redirects };
};

export const publicPathFor = (page: PublicPage): string => {
  return page.metadata.slug;
};

export const feedPathFor = (kind: FeedKind): Readonly<{ canonical: string; legacy: string }> => ({
  canonical: `/feeds/${kind}.xml`,
  legacy: kind === "all" ? "/feed.xml" : `/${kind}.xml`,
});

export const formatPublicDate = (value: string): string => {
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};

const headingText = (html: string): string => html
  .replaceAll(/<[^>]+>/gu, "")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .trim();

export const articlePresentation = (title: string, html: string): ArticlePresentation => {
  const leadingH1 = /^\s*<h1 id="([A-Za-z0-9][A-Za-z0-9._:-]*)">([\s\S]*?)<\/h1>\s*/u.exec(html);
  const embeddedH1 = /^\s*<div id="wikai-mdx-root">\s*<h1(?: id="([A-Za-z0-9][A-Za-z0-9._:-]*)")?>([\s\S]*?)<\/h1>/u.exec(html);
  const heading = leadingH1 ?? embeddedH1;
  const leadingMarkup = heading?.[0];
  const leadingId = heading?.[1];
  const leadingText = heading?.[2];
  const matchesTitle = leadingMarkup !== undefined && leadingText !== undefined && headingText(leadingText) === title.trim();
  const presentedHtml = matchesTitle && leadingH1 !== null ? html.slice(leadingMarkup.length) : html;
  const seen = new Set<string>();
  const toc = [...presentedHtml.matchAll(/<h([2-6]) id="([^"]+)">([\s\S]*?)<\/h\1>/gu)].flatMap((match) => {
    const depth = match[1];
    const id = match[2];
    const innerHtml = match[3];
    if (depth === undefined || id === undefined || innerHtml === undefined) return [];
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ depth: Number(depth), id, text: headingText(innerHtml) }];
  });
  return {
    html: presentedHtml,
    ...(matchesTitle && leadingId !== undefined ? { headingId: leadingId } : {}),
    embeddedHeading: matchesTitle && embeddedH1 !== null,
    toc,
  };
};

export const collectionPages = (pages: readonly PublicPage[], kind: Exclude<PublicKind, "page">): readonly PublicPage[] => pages
  .filter((page) => page.metadata.kind === kind && page.metadata.listed)
  .sort((left, right) => (right.metadata.publishedAt ?? right.metadata.log?.occurredAt ?? "").localeCompare(left.metadata.publishedAt ?? left.metadata.log?.occurredAt ?? ""));

export const searchPages = (pages: readonly PublicPage[], includeLog: boolean): readonly PublicPage[] => pages.filter((page) => page.metadata.listed && (page.metadata.kind === "work" || page.metadata.kind === "knowledge" || (includeLog && page.metadata.kind === "log")));

export const feedPages = (pages: readonly PublicPage[], kind: FeedKind): readonly PublicPage[] => pages.filter((page) => page.metadata.feed && page.metadata.kind !== "page" && (kind === "all" || page.metadata.kind === kind));

export const sitemapPages = (pages: readonly PublicPage[]): readonly PublicPage[] => pages.filter((page) => page.metadata.index);

export const safeCanonical = (page: PublicPage, site: URL): URL => {
  if (page.metadata.canonical === undefined) return new URL(publicPathFor(page), site);
  const canonical = new URL(page.metadata.canonical);
  if (canonical.protocol !== "https:" && canonical.protocol !== "http:") return new URL(publicPathFor(page), site);
  return canonical;
};
