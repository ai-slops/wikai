import type { APIRoute } from "astro";
import { escapeXml } from "../lib/xml.ts";

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://example.invalid");
  const location = escapeXml(new URL("/sitemap-0.xml", base).href);
  return new Response(`<?xml version="1.0" encoding="utf-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${location}</loc></sitemap></sitemapindex>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
