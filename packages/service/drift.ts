import type { VaultSnapshot, WorkingPublication } from "../model/index.ts";
import type { PublisherState } from "../state/index.ts";
import { selectedSourceHash } from "./selection.ts";

type DriftInput = {
  readonly state: PublisherState;
  readonly publicId: string;
  readonly working: WorkingPublication | null | undefined;
  readonly vault: VaultSnapshot;
};

export async function hasSourceDrift(input: DriftInput): Promise<boolean> {
  const approvedSourceHash = await input.state.approvedSourceHash(input.publicId);
  if (approvedSourceHash === null && (await input.state.approved(input.publicId)) !== null)
    return true;
  if (approvedSourceHash !== null && input.working?.sourceHash !== approvedSourceHash) return true;
  const sources =
    approvedSourceHash === null
      ? (input.working?.sources ??
        input.vault.documents.find((document) => document.frontmatter.public?.id === input.publicId)
          ?.frontmatter.public?.sources ??
        [])
      : await input.state.approvedSources(input.publicId);
  if (sources === null) return true;
  const documentsById = new Map(
    input.vault.documents.flatMap((document) =>
      document.frontmatter.id === undefined ? [] : [[document.frontmatter.id, document]],
    ),
  );
  return sources.some((source) => {
    const document = documentsById.get(source.id);
    if (document === undefined) return true;
    if (source.capturedHash === undefined) return approvedSourceHash !== null;
    const currentHash =
      source.selection === undefined
        ? document.sourceHash
        : selectedSourceHash(document.body, source);
    return currentHash !== source.capturedHash;
  });
}
