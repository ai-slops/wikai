import type { PublicKind } from "./publication.ts";

export type PageLayout = "home" | "about" | "now" | "contact" | "generic";

const FIXED_PAGE_ROUTES = {
  home: "/",
  about: "/about",
  now: "/now",
  contact: "/contact",
} as const;

export const publicRouteKey = (route: string): string =>
  route.normalize("NFC").toLocaleLowerCase("en-US");

export const isCanonicalPublicRoute = (route: string): boolean => {
  if (!route.startsWith("/") || (route.length > 1 && route.endsWith("/"))) return false;
  if (route.includes("//") || route.includes("?") || route.includes("#") || route.includes("\\"))
    return false;
  if (route !== route.normalize("NFC")) return false;
  if (
    [...route].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  )
    return false;
  try {
    return (
      route.split("/").every((segment) => ![".", ".."].includes(decodeURIComponent(segment))) &&
      !/%2f|%5c/iu.test(route)
    );
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
};

export const isFixedPageRoute = (route: string): boolean =>
  Object.values(FIXED_PAGE_ROUTES).some((fixed) => publicRouteKey(fixed) === publicRouteKey(route));

export const routeMatchesKind = (route: string, kind: PublicKind, layout?: PageLayout): boolean => {
  if (kind !== "page") return route.startsWith(`/${kind}/`);
  if (layout === undefined) return false;
  if (layout === "generic") return !isFixedPageRoute(route);
  return publicRouteKey(route) === publicRouteKey(FIXED_PAGE_ROUTES[layout]);
};
