import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://example.invalid");
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap-index.xml", base).href}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
