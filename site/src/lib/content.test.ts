import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  articlePresentation,
  feedPages,
  feedPathFor,
  formatPublicDate,
  loadContent,
  publicPathFor,
  searchPages,
  sitemapPages,
} from "./content.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "wikai-site-content-")); await writeFile(join(root, "redirects.json"), JSON.stringify({ schemaVersion: 1, redirects: [] })); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

type MetadataFixture = Readonly<{
  id: string;
  kind: "work" | "knowledge" | "log" | "page";
  slug: string;
  index: boolean;
  feed: boolean;
}>;

const metadata = ({ id, kind, slug, index, feed }: MetadataFixture) => ({
  id, kind, slug, title: slug, tags: [], aliases: [], listed: true, index, feed, featured: false,
  ...(kind === "log" ? { log: { occurredAt: "2026-09-19" } } : {}),
});

describe("public content contract", () => {
  it("parses approved pages and maps each kind to its public route", async () => {
    // Given a valid staging index, when loaded, then routes are derived only from safe public metadata.
    await writeFile(join(root, "content-index.json"), JSON.stringify({ schemaVersion: 1, pages: [
      { metadata: metadata({ id: "pub_work", kind: "work", slug: "/work/signal", index: true, feed: true }), markdown: "", html: "<p>work</p>", outgoingLinks: [], backlinks: [], assets: [] },
      { metadata: { ...metadata({ id: "pub_about", kind: "page", slug: "/about", index: true, feed: false }), page: { layout: "about" } }, markdown: "", html: "<p>about</p>", outgoingLinks: [], backlinks: [], assets: [] },
    ] }));
    const content = await loadContent(root);
    expect(content.pages.map(publicPathFor)).toEqual(["/work/signal", "/about"]);
  });

  it("applies independent search, feed, and sitemap publication policies", async () => {
    // Given work, knowledge, and noindex log pages, when policies run, then search excludes Log by default while feeds and sitemap honor their flags.
    await writeFile(join(root, "content-index.json"), JSON.stringify({ schemaVersion: 1, pages: [
      { metadata: metadata({ id: "pub_work", kind: "work", slug: "/work/work", index: true, feed: true }), markdown: "", html: "", outgoingLinks: [], backlinks: [], assets: [] },
      { metadata: metadata({ id: "pub_note", kind: "knowledge", slug: "/knowledge/note", index: true, feed: false }), markdown: "", html: "", outgoingLinks: [], backlinks: [], assets: [] },
      { metadata: metadata({ id: "pub_log", kind: "log", slug: "/log/log", index: false, feed: true }), markdown: "", html: "", outgoingLinks: [], backlinks: [], assets: [] },
    ] }));
    const pages = (await loadContent(root)).pages;
    expect(searchPages(pages, false).map((page) => page.metadata.kind)).toEqual(["work", "knowledge"]);
    expect(searchPages(pages, true)).toHaveLength(3);
    expect(feedPages(pages, "all").map((page) => page.metadata.kind)).toEqual(["work", "log"]);
    expect(sitemapPages(pages).map((page) => page.metadata.kind)).toEqual(["work", "knowledge"]);
  });

  it("uses canonical feed paths while retaining legacy feed paths", () => {
    // Given every feed kind, when paths are generated, then canonical paths use /feeds and legacy paths remain available.
    expect(feedPathFor("all")).toEqual({ canonical: "/feeds/all.xml", legacy: "/feed.xml" });
    expect(feedPathFor("knowledge")).toEqual({ canonical: "/feeds/knowledge.xml", legacy: "/knowledge.xml" });
  });

  it("removes only a matching leading article H1 and preserves its anchor", () => {
    // Given safe rendered HTML beginning with the metadata title, when presented, then the visible duplicate is removed and its id moves to the page heading.
    const presentation = articlePresentation("A deliberate boundary", '<h1 id="a-deliberate-boundary">A deliberate boundary</h1><h2 id="why">Why</h2><p>Body</p>');
    expect(presentation.headingId).toBe("a-deliberate-boundary");
    expect(presentation.html).toBe('<h2 id="why">Why</h2><p>Body</p>');
    expect(presentation.toc).toEqual([{ depth: 2, id: "why", text: "Why" }]);
  });

  it("keeps a distinct leading H1 and excludes unsafe or duplicate TOC anchors", () => {
    // Given distinct and malformed headings, when presented, then body semantics stay intact and TOC links include only unique safe fragments.
    const html = '<h1 id="context">Context</h1><h2 id="safe">Safe <em>heading</em></h2><h3 id="safe">Duplicate</h3><h2 id="bad anchor">Bad</h2>';
    const presentation = articlePresentation("Article title", html);
    expect(presentation.headingId).toBeUndefined();
    expect(presentation.html).toBe(html);
    expect(presentation.toc).toEqual([{ depth: 2, id: "safe", text: "Safe heading" }]);
  });

  it("formats public dates without exposing raw ISO timestamps", () => {
    // Given date-only and timestamp metadata, when formatted, then both render as stable human-readable UTC dates.
    expect(formatPublicDate("2026-09-01")).toBe("1 September 2026");
    expect(formatPublicDate("2026-09-19T17:53:25.178Z")).toBe("19 September 2026");
  });
});
