import type { APIRoute } from "astro";
import { loadContent, publicPathFor, sitemapPages } from "../lib/content.ts";
import { escapeXml } from "../lib/xml.ts";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://example.invalid");
  const { pages } = await loadContent();
  const urls = sitemapPages(pages).map((page) => `<url><loc>${escapeXml(new URL(publicPathFor(page), base).href)}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
