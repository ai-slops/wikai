import { feedPages, feedPathFor, loadContent, publicPathFor } from "./content.ts";
import type { FeedKind } from "./content.ts";
import { escapeXml } from "./xml.ts";

export const FEED_KINDS = ["all", "work", "knowledge", "log"] satisfies readonly FeedKind[];

export const atomFeedResponse = async (kind: FeedKind, base: URL, canonicalSelf = true): Promise<Response> => {
  const { pages } = await loadContent();
  const feedPagesForKind = feedPages(pages, kind);
  const entries = feedPagesForKind.map((page) => {
    const url = new URL(publicPathFor(page), base).href;
    const updated = page.metadata.updatedAt ?? page.metadata.publishedAt ?? page.metadata.log?.occurredAt ?? "1970-01-01T00:00:00.000Z";
    return `<entry><id>${escapeXml(url)}</id><title>${escapeXml(page.metadata.title)}</title><link href="${escapeXml(url)}"/><updated>${escapeXml(updated)}</updated><summary>${escapeXml(page.metadata.summary ?? "")}</summary></entry>`;
  }).join("");
  const updated = feedPagesForKind.map((page) => page.metadata.updatedAt ?? page.metadata.publishedAt ?? page.metadata.log?.occurredAt ?? "1970-01-01T00:00:00.000Z").sort().at(-1) ?? "1970-01-01T00:00:00.000Z";
  const title = kind === "all" ? "Wikai" : `Wikai ${kind}`;
  const paths = feedPathFor(kind);
  const self = new URL(canonicalSelf ? paths.canonical : paths.legacy, base).href;
  const body = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeXml(new URL(paths.canonical, base).href)}</id><title>${escapeXml(title)}</title><updated>${escapeXml(updated)}</updated><link href="${escapeXml(self)}" rel="self"/>${entries}</feed>`;
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
};
