import { auditDist } from "../audit/index.ts";
import { compile, loadVault } from "../compiler/index.ts";
import { loadConfig } from "../config/index.ts";
import type {
  ApprovedRevision,
  PublicationPlan,
  PublisherConfig,
  WorkingPublication,
} from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { buildReleaseStaging, buildSite } from "../release/index.ts";
import { PublisherState } from "../state/index.ts";
import { assertExplicitSlug, captureApproval } from "./approval.ts";
import { hasSourceDrift } from "./drift.ts";
import { createExtraction, createProject } from "./projection.ts";
import {
  type CandidateInput,
  CandidateInputSchema,
  DetailSchema,
  type ExtractInput,
  ExtractInputSchema,
  type MetadataPatch,
  MetadataPatchSchema,
  type ProjectInput,
  ProjectInputSchema,
  type PublicationDetail,
  type PublisherStatus,
} from "./schema.ts";
import { markCandidate, patchMetadata } from "./source.ts";
import { createStatus } from "./status.ts";

export type PublisherPlan = PublicationPlan & {
  readonly approved: readonly ApprovedRevision[];
  readonly redirects: Awaited<ReturnType<PublisherState["snapshot"]>>["redirects"];
};

export type PreviewResult =
  | { readonly mode: "working"; readonly publications: readonly WorkingPublication[] }
  | { readonly mode: "approved"; readonly publications: readonly ApprovedRevision[] };

export class Publisher {
  readonly config: PublisherConfig;
  private readonly state: PublisherState;

  private constructor(config: PublisherConfig, state: PublisherState) {
    this.config = config;
    this.state = state;
  }

  static async open(configPath?: string): Promise<Publisher> {
    const config = configPath === undefined ? await loadConfig() : await loadConfig(configPath);
    return new Publisher(config, await PublisherState.open(config.publisher.stateDir));
  }

  async plan(): Promise<PublisherPlan> {
    const snapshot = await this.state.snapshot();
    const vault = await loadVault(this.config);
    const plan = await compile(vault, this.config, snapshot.approved);
    return { ...plan, approved: snapshot.approved, redirects: snapshot.redirects };
  }

  async status(): Promise<PublisherStatus> {
    const plan = await this.plan();
    const vault = await loadVault(this.config);
    return createStatus({ plan, state: this.state, approved: plan.approved, vault });
  }

  async detail(publicId: string): Promise<PublicationDetail> {
    const plan = await this.plan();
    const working =
      plan.publications.find((publication) => publication.publicId === publicId) ?? null;
    const approved = await this.state.approved(publicId);
    const history = [...(await this.state.history(publicId))];
    const diagnostics = plan.diagnostics.filter((diagnostic) => diagnostic.publicId === publicId);
    const vault = await loadVault(this.config);
    const sourceDrift = await hasSourceDrift({ state: this.state, publicId, working, vault });
    if (working === null && approved === null && history.length === 0 && diagnostics.length === 0) {
      throw new PublisherError("PUBLICATION_NOT_FOUND", "The publication was not found");
    }
    return DetailSchema.parse({ working, approved, history, sourceDrift, diagnostics });
  }

  async approve(publicId: string, expectedHash: string): Promise<ApprovedRevision> {
    const plan = await this.plan();
    const working = plan.publications.find((publication) => publication.publicId === publicId);
    if (working === undefined) {
      throw new PublisherError("PUBLICATION_NOT_FOUND", "The publication was not found");
    }
    const vault = await loadVault(this.config);
    assertExplicitSlug(working, vault);
    const relevantErrors = [...working.diagnostics, ...plan.diagnostics].filter(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        (diagnostic.publicId === undefined || diagnostic.publicId === publicId),
    );
    if (relevantErrors.length > 0) {
      throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
    }
    return this.state.approve(working, expectedHash, async () => {
      const currentSnapshot = await this.state.snapshot();
      const currentVault = await loadVault(this.config);
      const currentPlan = await compile(currentVault, this.config, currentSnapshot.approved);
      const currentWorking = currentPlan.publications.find(
        (publication) => publication.publicId === publicId,
      );
      const currentErrors = currentPlan.diagnostics.filter(
        (diagnostic) =>
          diagnostic.severity === "error" &&
          (diagnostic.publicId === undefined || diagnostic.publicId === publicId),
      );
      if (currentWorking === undefined || currentErrors.length > 0) {
        throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
      }
      if (currentWorking.exposureHash !== expectedHash) {
        throw new PublisherError("STALE_EXPOSURE_HASH", "The publication changed before approval");
      }
      assertExplicitSlug(currentWorking, currentVault);
      return {
        working: currentWorking,
        ...(await captureApproval(this.config, currentWorking, currentVault)),
      };
    });
  }

  async withdraw(publicId: string, expectedHash: string, redirect?: string): Promise<void> {
    await this.state.withdraw(publicId, expectedHash, redirect);
  }

  async candidate(input: CandidateInput): ReturnType<typeof markCandidate> {
    return markCandidate(this.config, CandidateInputSchema.parse(input));
  }

  async project(input: ProjectInput): ReturnType<typeof createProject> {
    return createProject(this.config, ProjectInputSchema.parse(input));
  }

  async extract(input: ExtractInput): ReturnType<typeof createExtraction> {
    return createExtraction(this.config, ExtractInputSchema.parse(input));
  }

  async updateMetadata(
    publicId: string,
    patch: MetadataPatch,
    expectedHash: string,
  ): ReturnType<typeof patchMetadata> {
    const vault = await loadVault(this.config);
    const document = vault.documents.find(
      (candidate) => candidate.frontmatter.public?.id === publicId,
    );
    if (document === undefined) {
      throw new PublisherError("PUBLICATION_NOT_FOUND", "The publication was not found");
    }
    return patchMetadata(
      this.config,
      document.sourcePath,
      publicId,
      MetadataPatchSchema.parse(patch),
      expectedHash,
    );
  }

  async preview(mode: "working" | "approved", publicId?: string): Promise<PreviewResult> {
    if (mode === "working") {
      const plan = await this.plan();
      return {
        mode,
        publications:
          publicId === undefined
            ? plan.publications
            : plan.publications.filter((publication) => publication.publicId === publicId),
      };
    }
    const approved = (await this.state.snapshot()).approved;
    return {
      mode,
      publications:
        publicId === undefined
          ? approved
          : approved.filter((publication) => publication.publicId === publicId),
    };
  }

  async build(): Promise<{
    readonly manifest: Awaited<ReturnType<typeof buildReleaseStaging>>;
    readonly distPath: string;
  }> {
    const snapshot = await this.state.snapshot();
    const vault = await loadVault(this.config);
    const manifest = await buildReleaseStaging(snapshot.approved, this.config, snapshot.redirects);
    const built = await buildSite(this.config, vault);
    return { manifest, distPath: built.distPath };
  }

  async audit(path: string): ReturnType<typeof auditDist> {
    return auditDist(path, this.config, await loadVault(this.config));
  }

  async restore(
    publicId: string,
    revisionHash: string,
    expectedHash: string,
  ): Promise<ApprovedRevision> {
    return this.state.restore(publicId, revisionHash, expectedHash);
  }
}

export type {
  CandidateInput,
  ExtractInput,
  MetadataPatch,
  ProjectInput,
  PublicationDetail,
  PublisherStatus,
  StatusRow,
} from "./schema.ts";
export {
  CandidateInputSchema,
  DetailSchema,
  ExtractInputSchema,
  LineSelectionSchema,
  MetadataPatchSchema,
  ProjectInputSchema,
  PublicationStatusSchema,
  StatusRowSchema,
  StatusSchema,
} from "./schema.ts";
