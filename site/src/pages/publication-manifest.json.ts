import type { APIRoute } from "astro";
import { loadContent } from "../lib/content.ts";

export const GET: APIRoute = async () => {
  const { pages } = await loadContent();
  return Response.json({ schemaVersion: 1, pages: pages.map((page) => page.metadata) });
};
