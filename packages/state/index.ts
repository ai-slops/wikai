import type { ApprovedRevision, PublicRedirect, WorkingPublication } from "../model/index.ts";
import { readStateDocument } from "./document.ts";
import {
  type ApprovalCapture,
  approvePublication,
  recordDeployment,
  restorePublication,
  withdrawPublication,
} from "./mutations.ts";
import { publicRevision, readRevision } from "./revision.ts";
import type { SourceIdentity, StateSnapshot } from "./schema.ts";

export class PublisherState {
  private readonly stateDir: string;

  private constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  static async open(stateDir: string): Promise<PublisherState> {
    const state = new PublisherState(stateDir);
    await readStateDocument(stateDir);
    return state;
  }

  async approve(
    working: WorkingPublication,
    expectedHash: string,
    capture?: () => Promise<ApprovalCapture>,
  ): Promise<ApprovedRevision> {
    return approvePublication({
      stateDir: this.stateDir,
      working,
      expectedHash,
      ...(capture === undefined ? {} : { capture }),
    });
  }

  async withdraw(publicId: string, expectedHash: string, redirect?: string): Promise<void> {
    await withdrawPublication({
      stateDir: this.stateDir,
      publicId,
      expectedHash,
      ...(redirect === undefined ? {} : { redirect }),
    });
  }

  async restore(
    publicId: string,
    revisionHash: string,
    expectedHash: string,
  ): Promise<ApprovedRevision> {
    return restorePublication({
      stateDir: this.stateDir,
      publicId,
      revisionHash,
      expectedHash,
    });
  }

  async recordDeployment(revisions: Readonly<Record<string, string>>): Promise<void> {
    await recordDeployment(this.stateDir, revisions);
  }

  async recordRollback(revisions: Readonly<Record<string, string>>): Promise<void> {
    await recordDeployment(this.stateDir, revisions, "history");
  }

  async reviewTimes(): Promise<Record<string, string>> {
    const document = await readStateDocument(this.stateDir);
    return Object.fromEntries(
      Object.entries(document.publications).flatMap(([publicId, entry]) =>
        entry.lastReviewedAt === undefined ? [] : [[publicId, entry.lastReviewedAt]],
      ),
    );
  }

  async approved(publicId: string): Promise<ApprovedRevision | null> {
    const document = await readStateDocument(this.stateDir);
    const active = document.publications[publicId]?.activeRevisionHash;
    if (active === undefined || active === null) return null;
    return publicRevision(await readRevision(this.stateDir, publicId, active));
  }

  async history(publicId: string): Promise<readonly ApprovedRevision[]> {
    const document = await readStateDocument(this.stateDir);
    const hashes = document.publications[publicId]?.revisionHashes ?? [];
    return Promise.all(
      hashes.map(async (revisionHash) =>
        publicRevision(await readRevision(this.stateDir, publicId, revisionHash)),
      ),
    );
  }

  async approvedSourceHash(publicId: string): Promise<string | null> {
    return (
      (await readStateDocument(this.stateDir)).publications[publicId]?.activeSourceHash ?? null
    );
  }

  async approvedSources(publicId: string): Promise<WorkingPublication["sources"] | null> {
    const entry = (await readStateDocument(this.stateDir)).publications[publicId];
    return entry === undefined ? [] : entry.activeSources;
  }

  async publicationIds(): Promise<readonly string[]> {
    return Object.keys((await readStateDocument(this.stateDir)).publications).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  async source(publicId: string): Promise<SourceIdentity | null> {
    const entry = (await readStateDocument(this.stateDir)).publications[publicId];
    if (entry === undefined) return null;
    return {
      sourceId: entry.sourceId,
      sourcePath: entry.sourcePath,
      sourceMode: entry.sourceMode,
    };
  }

  async snapshot(): Promise<StateSnapshot> {
    const document = await readStateDocument(this.stateDir);
    const approved: ApprovedRevision[] = [];
    const redirects: PublicRedirect[] = [];
    for (const [publicId, entry] of Object.entries(document.publications)) {
      if (entry.activeRevisionHash !== null) {
        const revision = publicRevision(
          await readRevision(this.stateDir, publicId, entry.activeRevisionHash),
        );
        approved.push(revision);
        for (const alias of revision.metadata.aliases) {
          redirects.push({ from: alias, to: revision.metadata.slug, status: 301 });
        }
      } else if (entry.withdrawalFrom !== undefined && entry.withdrawalRedirect !== undefined) {
        redirects.push({ from: entry.withdrawalFrom, to: entry.withdrawalRedirect, status: 301 });
      }
    }
    return { approved, redirects };
  }
}

export type { StateDocument, StateSnapshot } from "./schema.ts";
export { StateDocumentSchema, StateSnapshotSchema } from "./schema.ts";
