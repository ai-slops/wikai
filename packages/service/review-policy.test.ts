import { describe, expect, it } from "vitest";
import type { ApprovedRevision, PublisherConfig } from "../model/index.ts";
import { ConfigSchema } from "../model/index.ts";
import { reviewAgeDiagnostics } from "./review-policy.ts";

const config = (review?: PublisherConfig["review"]): PublisherConfig =>
  ConfigSchema.parse({
    vault: { root: "/vault" },
    publisher: {
      stateDir: "/state",
      previewStagingDir: "/preview",
      releaseStagingDir: "/release",
    },
    ...(review === undefined ? {} : { review }),
    site: { sourceDir: "/site", distDir: "/dist" },
  });

const approved = (
  publicId: string,
  kind: ApprovedRevision["metadata"]["kind"],
): ApprovedRevision => ({
  publicId,
  revisionHash: `sha256:${publicId}`,
  exposureHash: `sha256:exposure-${publicId}`,
  metadata: {
    id: publicId,
    kind,
    slug: `/${publicId}`,
    title: publicId,
    tags: [],
    aliases: [],
    listed: true,
    index: true,
    feed: true,
    featured: false,
  },
  markdown: "body",
  html: "<p>body</p>",
  outgoingLinks: [],
  assets: [],
  approvedAt: "2025-01-01T00:00:00.000Z",
});

describe("review age diagnostics", () => {
  it("uses per-kind defaults, disables logs, and honors private review timestamps", () => {
    // Given only active approved revisions and a newer private review timestamp for one item.
    const revisions = [
      approved("pub_old_work", "work"),
      approved("pub_recent_knowledge", "knowledge"),
      approved("pub_old_page", "page"),
      approved("pub_old_log", "log"),
    ];
    const snapshot = structuredClone(revisions);

    // When review age is evaluated at an injected instant.
    const diagnostics = reviewAgeDiagnostics({
      approved: revisions,
      config: config(),
      now: new Date("2025-08-01T00:00:00.000Z"),
      reviewedAt: { pub_recent_knowledge: "2025-07-01T00:00:00.000Z" },
    });

    // Then only overdue enabled kinds warn and approved snapshots remain immutable.
    expect(diagnostics.map(({ publicId }) => publicId)).toEqual(["pub_old_work"]);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({ code: "REVIEW_OVERDUE", severity: "warning" }),
    );
    expect(revisions).toEqual(snapshot);
  });

  it("honors overrides including zero as disabled", () => {
    // Given short custom windows with work explicitly disabled.
    const publisherConfig = config({
      warnAfterDays: { work: 0, knowledge: 10, page: 10, log: 10 },
    });

    // When review ages are calculated.
    const diagnostics = reviewAgeDiagnostics({
      approved: [approved("pub_work", "work"), approved("pub_log", "log")],
      config: publisherConfig,
      now: new Date("2025-02-01T00:00:00.000Z"),
    });

    // Then the disabled kind is omitted and the enabled overdue kind warns.
    expect(diagnostics.map(({ publicId }) => publicId)).toEqual(["pub_log"]);
  });
});
