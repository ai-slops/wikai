import { readFile } from "node:fs/promises";
import { hash, safePath } from "../fs/index.ts";
import type { PublisherConfig, VaultSnapshot, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { selectedSourceHash } from "./selection.ts";
import { markPublished } from "./source.ts";

export function assertExplicitSlug(working: WorkingPublication, vault: VaultSnapshot): void {
  const source = vault.documents.find((document) => document.sourcePath === working.sourcePath);
  if (source?.frontmatter.public?.slug === undefined) {
    throw new PublisherError("PUBLIC_SLUG_REQUIRED", "Approval requires an explicit public slug");
  }
}

export async function captureApproval(
  config: PublisherConfig,
  working: WorkingPublication,
  vault: VaultSnapshot,
): Promise<{ readonly sourceHash: string; readonly sources: WorkingPublication["sources"] }> {
  const documentsById = new Map(
    vault.documents.flatMap((document) =>
      document.frontmatter.id === undefined ? [] : [[document.frontmatter.id, document]],
    ),
  );
  const sources = await Promise.all(
    working.sources.map(async (source) => {
      const document = documentsById.get(source.id);
      if (document === undefined) {
        throw new PublisherError("SOURCE_NOT_FOUND", "A private source dependency was not found");
      }
      const path = await safePath(config.vault.root, document.sourcePath);
      const currentHash = hash(await readFile(path));
      if (currentHash !== document.sourceHash) {
        throw new PublisherError(
          "CONCURRENT_SOURCE_MODIFICATION",
          "A private source dependency changed before approval",
        );
      }
      return {
        ...source,
        capturedHash:
          source.selection === undefined
            ? currentHash
            : (selectedSourceHash(document.body, source) ?? source.capturedHash),
      };
    }),
  );
  return {
    sourceHash: await markPublished(config, working.sourcePath, working.sourceHash),
    sources,
  };
}

export async function captureComponentApproval(
  config: PublisherConfig,
  working: WorkingPublication,
  vault: VaultSnapshot,
): Promise<{ readonly sourceHash: string; readonly sources: WorkingPublication["sources"] }> {
  const documentsById = new Map(
    vault.documents.flatMap((document) =>
      document.frontmatter.id === undefined ? [] : [[document.frontmatter.id, document]],
    ),
  );
  const sourceDocument = vault.documents.find(
    (document) => document.sourcePath === working.sourcePath,
  );
  if (sourceDocument === undefined) {
    throw new PublisherError("SOURCE_NOT_FOUND", "The publication source was not found");
  }
  const sourceHash = hash(
    await readFile(await safePath(config.vault.root, sourceDocument.sourcePath)),
  );
  if (sourceHash !== working.sourceHash) {
    throw new PublisherError(
      "CONCURRENT_SOURCE_MODIFICATION",
      "The publication source changed before component approval",
    );
  }
  const sources = await Promise.all(
    working.sources.map(async (source) => {
      const document = documentsById.get(source.id);
      if (document === undefined) {
        throw new PublisherError("SOURCE_NOT_FOUND", "A private source dependency was not found");
      }
      const currentHash = hash(
        await readFile(await safePath(config.vault.root, document.sourcePath)),
      );
      if (currentHash !== document.sourceHash) {
        throw new PublisherError(
          "CONCURRENT_SOURCE_MODIFICATION",
          "A private source dependency changed before component approval",
        );
      }
      return {
        ...source,
        capturedHash:
          source.selection === undefined
            ? currentHash
            : (selectedSourceHash(document.body, source) ?? source.capturedHash),
      };
    }),
  );
  return { sourceHash, sources };
}
