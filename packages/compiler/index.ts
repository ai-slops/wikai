import { MarkdownError } from "../markdown/index.ts";
import type {
  ApprovedRevision,
  Diagnostic,
  PrivateDocument,
  PublicationPlan,
  PublisherConfig,
  VaultSnapshot,
  WorkingPublication,
} from "../model/index.ts";
import { publicRouteKey } from "../model/index.ts";
import { loadVault as readVault } from "../vault/index.ts";
import { CompilerError } from "./metadata.ts";
import { compileDocument } from "./publication.ts";
import { approvedTarget, buildVaultTargets } from "./targets.ts";

const errorDiagnostic = (code: string, message: string, document: PrivateDocument): Diagnostic => ({
  code,
  severity: "error",
  message,
  sourcePath: document.sourcePath,
  ...(document.frontmatter.public ? { publicId: document.frontmatter.public.id } : {}),
});

const publicationRoutes = (publication: WorkingPublication): readonly string[] =>
  [publication.metadata.slug, ...publication.metadata.aliases].map(publicRouteKey);

const collisionValues = (
  publications: readonly WorkingPublication[],
): {
  readonly ids: ReadonlySet<string>;
  readonly slugs: ReadonlySet<string>;
  readonly routes: ReadonlySet<string>;
} => {
  const ids = new Set(
    publications
      .filter((publication, index, all) =>
        all.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index && candidate.publicId === publication.publicId,
        ),
      )
      .map(({ publicId }) => publicId),
  );
  const slugs = new Set(
    publications
      .filter((publication, index, all) =>
        all.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index &&
            candidate.metadata.slug.toLocaleLowerCase("en-US") ===
              publication.metadata.slug.toLocaleLowerCase("en-US"),
        ),
      )
      .map(({ metadata }) => metadata.slug.toLocaleLowerCase("en-US")),
  );
  const owners = new Map<string, Set<string>>();
  for (const publication of publications) {
    for (const route of publicationRoutes(publication)) {
      const routeOwners = owners.get(route) ?? new Set<string>();
      routeOwners.add(publication.publicId);
      owners.set(route, routeOwners);
    }
  }
  const routes = new Set(
    [...owners.entries()].filter(([, routeOwners]) => routeOwners.size > 1).map(([route]) => route),
  );
  return { ids, slugs, routes };
};

export const loadVault = readVault;

export const compile = async (
  vault: VaultSnapshot,
  config: PublisherConfig,
  approvedRevisions: readonly ApprovedRevision[] = [],
): Promise<PublicationPlan> => {
  const diagnostics: Diagnostic[] = [...vault.diagnostics];
  const publications: WorkingPublication[] = [];
  const approved = approvedRevisions.map(approvedTarget);
  const context = { config, approved, vaultTargets: buildVaultTargets(vault.documents, approved) };
  for (const document of vault.documents) {
    if (!document.frontmatter.public) continue;
    try {
      const publication = await compileDocument(document, context);
      const routes = new Set(publicationRoutes(publication));
      const reservation = approved.find(
        (target) =>
          target.publicId !== publication.publicId &&
          [target.slug, ...target.keys.filter((key) => key.startsWith("/"))]
            .map(publicRouteKey)
            .some((route) => routes.has(route)),
      );
      if (reservation) {
        const directSlug =
          publicRouteKey(reservation.slug) === publicRouteKey(publication.metadata.slug);
        throw new CompilerError(
          directSlug ? "PUBLIC_SLUG_RESERVED" : "PUBLIC_PATH_RESERVED",
          "Public path is already reserved",
        );
      }
      publications.push(publication);
      if (document.frontmatter.public.slug === undefined)
        diagnostics.push(
          errorDiagnostic(
            "PUBLIC_SLUG_REQUIRED",
            "Approval requires an explicit public slug",
            document,
          ),
        );
    } catch (error) {
      if (error instanceof MarkdownError || error instanceof CompilerError)
        diagnostics.push(errorDiagnostic(error.code, error.message, document));
      else if (error instanceof Error)
        diagnostics.push(
          errorDiagnostic(
            "PUBLICATION_COMPILE_FAILED",
            "Publication could not be compiled safely",
            document,
          ),
        );
      else throw error;
    }
  }
  const collisions = collisionValues(publications);
  for (const publication of publications) {
    const document = vault.documents.find(
      ({ sourcePath }) => sourcePath === publication.sourcePath,
    );
    if (!document) continue;
    if (collisions.ids.has(publication.publicId))
      diagnostics.push(errorDiagnostic("PUBLIC_ID_COLLISION", "Public ID is ambiguous", document));
    else if (collisions.slugs.has(publication.metadata.slug.toLocaleLowerCase("en-US")))
      diagnostics.push(
        errorDiagnostic("PUBLIC_SLUG_COLLISION", "Public path is ambiguous", document),
      );
    else if (publicationRoutes(publication).some((route) => collisions.routes.has(route)))
      diagnostics.push(
        errorDiagnostic("PUBLIC_ROUTE_COLLISION", "Public path is ambiguous", document),
      );
  }
  return {
    publications: publications.filter(
      (publication) =>
        !collisions.ids.has(publication.publicId) &&
        !collisions.slugs.has(publication.metadata.slug.toLocaleLowerCase("en-US")) &&
        !publicationRoutes(publication).some((route) => collisions.routes.has(route)),
    ),
    diagnostics,
  };
};
