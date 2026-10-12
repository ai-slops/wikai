import { vi } from "vitest";
import type { PublisherPort } from "./server.ts";

export const detail = {
  working: {
    publicId: "pub_alpha",
    exposureHash: "hash-working",
    html: "<h1>Working</h1>",
    markdown: "# Working",
    metadata: { title: "Working" },
    outgoingLinks: ["pub_beta"],
    assets: [{ publicPath: "/asset.png" }],
  },
  approved: {
    publicId: "pub_alpha",
    exposureHash: "hash-approved",
    html: "<h1>Approved</h1>",
    markdown: "# Approved",
    metadata: { title: "Approved" },
    outgoingLinks: [],
    assets: [],
  },
  history: [],
  sourceDrift: false,
};

export function publisher(): PublisherPort {
  return {
    status: vi.fn(async () => ({
      publications: [{ publicId: "pub_alpha", title: "Alpha" }],
      diagnostics: [],
    })),
    plan: vi.fn(async () => ({ publications: [], diagnostics: [], approved: [], redirects: [] })),
    detail: vi.fn(async () => detail),
    approve: vi.fn(async () => detail),
    withdraw: vi.fn(async () => undefined),
    candidate: vi.fn(async () => detail),
    project: vi.fn(async () => detail),
    extract: vi.fn(async () => detail),
    updateMetadata: vi.fn(async () => ({
      publicId: "pub_alpha",
      path: "notes/alpha.md",
      previousHash: "source-file-hash",
      sourceHash: "updated-source-hash",
    })),
    preview: vi.fn(async () => ({ mode: "working", publications: [{ html: "<h1>Preview</h1>" }] })),
    build: vi.fn(async () => ({ distPath: "/tmp/dist" })),
    audit: vi.fn(async () => []),
    inspectAsset: vi.fn(async (path) => ({
      sourcePath: path,
      originalName: "guide.pdf",
      prospectivePublicPath: "/assets/asset.pdf",
      sha256: "sha256:asset",
      bytes: 128,
      detectedMime: "application/pdf",
      underPublicAssets: true,
      hashReviewed: false,
      reviewBlockers: ["ASSET_REVIEW_REQUIRED"],
      referencesComplete: true,
      referringCandidateDocuments: [],
      inspection: { ok: true, detectedMime: "application/pdf", metadata: {}, notes: [] },
    })),
    sourceUpdate: vi.fn(async (_publicId, input) => ({
      publicId: "pub_alpha",
      sourceId: input.sourceId,
      sourcePath: "notes/source.md",
      projectionPath: "public-views/alpha.md",
      projectionHash: `sha256:${"b".repeat(64)}`,
      sourceHash: `sha256:${"c".repeat(64)}`,
      projectionBody: "# Existing projection",
      sourceBody: "# Updated source",
      expectedHash: `sha256:${"a".repeat(64)}`,
      canApply: true,
      diagnostics: [],
      referenceIndex: input.referenceIndex,
      changes: [{ value: "Updated source" }],
    })),
    applySourceUpdate: vi.fn(async () => ({
      publicId: "pub_alpha",
      path: "public-views/alpha.md",
      sourceHash: "sha256:merged",
    })),
    restore: vi.fn(async () => detail),
    tagList: vi.fn(async () => [
      { path: "topic", segment: "topic", directCount: 0, descendantCount: 1 },
      { path: "topic/react", segment: "react", directCount: 1, descendantCount: 1 },
    ]),
    tagTree: vi.fn(async () => [
      {
        path: "topic",
        segment: "topic",
        directCount: 0,
        descendantCount: 1,
        children: [],
      },
    ]),
    filterByTags: vi.fn(async () => [
      {
        publicId: "pub_alpha",
        title: "Alpha",
        sourcePath: "alpha.md",
        sourceHash: "hash",
        tags: ["topic/react"],
      },
    ]),
    planTagRename: vi.fn(async (input) => ({
      operation: "tag-rename",
      ...input,
      changes: [{ publicId: "pub_alpha", tagsBefore: ["topic/react"], tagsAfter: ["topic/ui"] }],
      canApply: true,
      expectedHash: `sha256:${"5".repeat(64)}`,
    })),
    applyTagRename: vi.fn(async (input) => ({
      applied: true,
      expectedHash: input.expectedHash,
      updated: 1,
    })),
    planComponentUpdateApproval: vi.fn(async () => ({
      operation: "component-update-approval",
      eligible: [{ publicId: "pub_alpha" }],
      skipped: [{ publicId: "pub_mixed", reasons: ["metadata-changed"] }],
      planHash: `sha256:${"6".repeat(64)}`,
    })),
    applyComponentUpdateApproval: vi.fn(async (expectedPlanHash) => ({
      applied: true,
      planHash: expectedPlanHash,
      approved: [{ publicId: "pub_alpha" }],
    })),
  };
}
