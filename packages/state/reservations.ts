import type { ApprovedRevision, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import type { StateDocument } from "./schema.ts";

function normalizedSlug(slug: string): string {
  return slug
    .normalize("NFC")
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase("en-US");
}

function assertNames(document: StateDocument, publicId: string, names: readonly string[]): void {
  const requested = new Set(names.map(normalizedSlug));
  if (requested.size !== names.length) {
    throw new PublisherError("SLUG_COLLISION", "Publication slugs and aliases must be unique");
  }
  for (const [ownerId, entry] of Object.entries(document.publications)) {
    if (ownerId === publicId) continue;
    if (entry.reservedSlugs.some((slug) => requested.has(normalizedSlug(slug)))) {
      throw new PublisherError("SLUG_COLLISION", "A publication slug or alias is reserved");
    }
  }
}

export function assertWorkingNamesAvailable(
  document: StateDocument,
  working: WorkingPublication,
): void {
  assertNames(document, working.publicId, [working.metadata.slug, ...working.metadata.aliases]);
}

export function assertRevisionNamesAvailable(
  document: StateDocument,
  publicId: string,
  revision: ApprovedRevision,
): void {
  assertNames(document, publicId, [revision.metadata.slug, ...revision.metadata.aliases]);
}
