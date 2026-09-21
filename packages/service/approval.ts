import { readFile } from "node:fs/promises";
import { hash, safePath } from "../fs/index.ts";
import type { PublisherConfig, VaultSnapshot, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
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
      return { ...source, capturedHash: currentHash };
    }),
  );
  return {
    sourceHash: await markPublished(config, working.sourcePath, working.sourceHash),
    sources,
  };
}
