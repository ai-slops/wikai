import type { VaultSnapshot, WorkingPublication } from "../model/index.ts";
import type { PublisherState } from "../state/index.ts";

type DriftInput = {
  readonly state: PublisherState;
  readonly publicId: string;
  readonly working: WorkingPublication | null | undefined;
  readonly vault: VaultSnapshot;
};

export async function hasSourceDrift(input: DriftInput): Promise<boolean> {
  const approvedSourceHash = await input.state.approvedSourceHash(input.publicId);
  if (approvedSourceHash === null) return false;
  if (input.working === null || input.working === undefined) return true;
  if (input.working.sourceHash !== approvedSourceHash) return true;
  const documentsById = new Map(
    input.vault.documents.flatMap((document) =>
      document.frontmatter.id === undefined ? [] : [[document.frontmatter.id, document]],
    ),
  );
  return (await input.state.approvedSources(input.publicId)).some((source) => {
    const document = documentsById.get(source.id);
    return document === undefined || source.capturedHash !== document.sourceHash;
  });
}
