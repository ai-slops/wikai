import type { APIRoute } from "astro";
import { loadContent } from "../lib/content.ts";

export const GET: APIRoute = async () => {
  const { redirects } = await loadContent();
  return Response.json({ schemaVersion: 1, redirects });
};
