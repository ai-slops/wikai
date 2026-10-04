import type { ApprovedRevision, PublicRedirect } from "../model/index.ts";
import {
  isCanonicalPublicRoute,
  isFixedPageRoute,
  isRendererRoute,
  publicRouteKey,
  routeMatchesKind,
} from "../model/index.ts";
import { ReleaseError } from "./error.ts";

const validateRoute = (route: string): void => {
  if (!isCanonicalPublicRoute(route))
    throw new ReleaseError(
      "RELEASE_INVALID_ROUTE",
      "Public slugs and redirects must be canonical absolute paths",
    );
};

export const validateReleaseGraph = (
  approved: readonly ApprovedRevision[],
  redirects: readonly PublicRedirect[],
): void => {
  const byId = new Map(approved.map((revision) => [revision.publicId, revision]));
  const routes = new Map<string, string>();
  const canonicalRoutes = new Map<string, ApprovedRevision>();
  if (byId.size !== approved.length)
    throw new ReleaseError(
      "RELEASE_DUPLICATE_ID",
      "Approved revisions contain a duplicate public identifier",
    );
  for (const revision of approved) {
    validateRoute(revision.metadata.slug);
    if (
      isRendererRoute(revision.metadata.slug) ||
      !routeMatchesKind(
        revision.metadata.slug,
        revision.metadata.kind,
        revision.metadata.page?.layout,
      )
    )
      throw new ReleaseError(
        "RELEASE_INVALID_ROUTE",
        "A public route does not match its content kind",
      );
    const slugKey = publicRouteKey(revision.metadata.slug);
    if (routes.has(slugKey))
      throw new ReleaseError(
        "RELEASE_DUPLICATE_ROUTE",
        "Approved revisions contain a duplicate public route",
      );
    routes.set(slugKey, revision.publicId);
    canonicalRoutes.set(slugKey, revision);
    for (const alias of revision.metadata.aliases) {
      validateRoute(alias);
      const aliasKey = publicRouteKey(alias);
      if (isRendererRoute(alias) || isFixedPageRoute(alias))
        throw new ReleaseError("RELEASE_INVALID_ROUTE", "A public alias is reserved");
      if (routes.has(aliasKey))
        throw new ReleaseError(
          "RELEASE_DUPLICATE_ROUTE",
          "Approved revisions contain a duplicate public route",
        );
      routes.set(aliasKey, revision.publicId);
    }
    for (const link of revision.outgoingLinks) {
      const target = byId.get(link.publicId);
      if (target === undefined || target.metadata.slug !== link.slug)
        throw new ReleaseError(
          "RELEASE_DANGLING_LINK",
          "Approved content contains a link outside the approved release graph",
        );
    }
  }
  for (const redirect of redirects) {
    validateRoute(redirect.from);
    validateRoute(redirect.to);
    const fromKey = publicRouteKey(redirect.from);
    const target = canonicalRoutes.get(publicRouteKey(redirect.to));
    const existingOwner = routes.get(fromKey);
    const isDeclaredAlias =
      target !== undefined &&
      existingOwner === target.publicId &&
      target.metadata.aliases.some((alias) => publicRouteKey(alias) === fromKey);
    if (
      isRendererRoute(redirect.from) ||
      isFixedPageRoute(redirect.from) ||
      target === undefined ||
      (existingOwner !== undefined && !isDeclaredAlias)
    )
      throw new ReleaseError(
        "RELEASE_INVALID_REDIRECT",
        "A redirect collides with or points outside the approved route graph",
      );
    routes.set(fromKey, target.publicId);
  }
};
