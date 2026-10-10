import { describe, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { ApprovedRevision, Diagnostic, PublicRedirect } from "../model/index.ts";
import { workingPublication } from "../state/test-fixture.ts";
import { createChangePlan, type LastBuildBaseline } from "./change-plan.ts";

const approved = (
  publicId: string,
  overrides: Partial<ApprovedRevision> = {},
): ApprovedRevision => {
  const working = workingPublication({
    publicId,
    sourceId: `prv_${publicId.slice(4)}`,
    metadata: {
      ...workingPublication().metadata,
      id: publicId,
      slug: `/knowledge/${publicId.slice(4)}`,
    },
  });
  return {
    publicId,
    revisionHash: hash(`revision:${publicId}`),
    exposureHash: working.exposureHash,
    metadata: working.metadata,
    markdown: working.markdown,
    html: working.html,
    outgoingLinks: working.outgoingLinks,
    assets: working.assets,
    approvedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
};

const blockedDiagnostic = (publicId: string): Diagnostic => ({
  code: "PUBLIC_MARKDOWN_FORBIDDEN",
  severity: "error",
  message: "Blocked public Markdown",
  publicId,
});

describe("publication change plan", () => {
  it("classifies proposals without treating blocked or missing working sources as withdrawals", () => {
    // Given active approvals plus added, updated, unchanged, blocked, and missing proposals.
    const stable = approved("pub_stable");
    const changed = approved("pub_changed");
    const orphaned = approved("pub_orphaned");
    const working = [
      workingPublication({ publicId: "pub_added", sourceId: "prv_added" }),
      workingPublication({
        publicId: "pub_changed",
        sourceId: "prv_changed",
        exposureHash: hash("changed exposure"),
        markdown: "Changed body",
      }),
      workingPublication({
        publicId: stable.publicId,
        sourceId: "prv_stable",
        exposureHash: stable.exposureHash,
        metadata: stable.metadata,
      }),
    ];

    // When the read-only change plan compares working proposals with active approvals.
    const result = createChangePlan({
      working,
      approved: [orphaned, stable, changed],
      diagnostics: [blockedDiagnostic("pub_blocked")],
      redirects: [],
      lastBuild: { available: false, reason: "missing-receipt" },
    });

    // Then every distinction is counted and records are sorted by public ID.
    expect(result.proposals.baseline).toBe("active-approved");
    expect(result.proposals.summary).toEqual({
      added: 1,
      updated: 1,
      unchanged: 1,
      blocked: 1,
      orphaned: 1,
    });
    expect(result.proposals.publications.map(({ publicId, status }) => [publicId, status])).toEqual(
      [
        ["pub_added", "added"],
        ["pub_blocked", "blocked"],
        ["pub_changed", "updated"],
        ["pub_orphaned", "orphaned"],
        ["pub_stable", "unchanged"],
      ],
    );
  });

  it("keeps an orphaned approval free of unrelated global diagnostics", () => {
    // Given an active approval with no working source and a global error from unrelated compilation.
    const orphaned = approved("pub_orphaned");
    const globalError: Diagnostic = {
      code: "PUBLIC_ROUTE_COLLISION",
      severity: "error",
      message: "An unrelated working route is invalid",
    };

    // When proposal changes are calculated without a working revision for the approval.
    const result = createChangePlan({
      working: [],
      approved: [orphaned],
      diagnostics: [globalError],
      redirects: [],
      lastBuild: { available: false, reason: "missing-receipt" },
    });

    // Then the missing source remains orphaned and does not inherit the unrelated diagnostic.
    expect(result.proposals.summary).toEqual({
      added: 0,
      updated: 0,
      unchanged: 0,
      blocked: 0,
      orphaned: 1,
    });
    expect(result.proposals.publications).toEqual([
      expect.objectContaining({ publicId: "pub_orphaned", status: "orphaned", diagnostics: [] }),
    ]);
  });

  it("reports deterministic metadata, URL, link, and same-path asset changes", () => {
    // Given a proposal whose public facets differ from its active approval.
    const before = approved("pub_changed", {
      metadata: {
        ...approved("pub_changed").metadata,
        slug: "/knowledge/old",
        aliases: ["/knowledge/legacy", "/knowledge/shared"],
        title: "Old title",
      },
      markdown: "Old body",
      outgoingLinks: [{ publicId: "pub_target", slug: "/knowledge/target", title: "Old target" }],
      assets: [
        {
          publicPath: "/assets/report.pdf",
          hash: hash("old asset"),
          mime: "application/pdf",
          bytes: 9,
          data: "b2xkIGFzc2V0",
          reviewed: true,
        },
      ],
    });
    const after = workingPublication({
      publicId: "pub_changed",
      sourceId: "prv_changed",
      exposureHash: hash("new exposure"),
      metadata: {
        ...before.metadata,
        slug: "/knowledge/new",
        aliases: ["/knowledge/shared", "/knowledge/recent"],
        title: "New title",
      },
      markdown: "New body",
      outgoingLinks: [{ publicId: "pub_target", slug: "/knowledge/target", title: "New target" }],
      assets: [
        {
          publicPath: "/assets/report.pdf",
          hash: hash("new asset"),
          mime: "application/pdf",
          bytes: 9,
          data: "bmV3IGFzc2V0",
          reviewed: true,
        },
      ],
    });

    // When proposal changes are calculated.
    const result = createChangePlan({
      working: [after],
      approved: [before],
      diagnostics: [],
      redirects: [],
      lastBuild: { available: false, reason: "missing-receipt" },
    });

    // Then each public facet has a stable, meaningful delta.
    const differences = result.proposals.publications[0]?.differences;
    expect(differences).toMatchObject({
      metadata: { changed: true, fields: ["aliases", "slug", "title"] },
      body: { changed: true },
      urls: {
        canonical: { before: "/knowledge/old", after: "/knowledge/new" },
        aliases: { added: ["/knowledge/recent"], removed: ["/knowledge/legacy"] },
      },
    });
    expect(differences?.links.updated).toEqual([
      expect.objectContaining({
        key: "pub_target#",
        before: expect.objectContaining({ title: "Old target" }),
      }),
    ]);
    expect(differences?.assets.updated).toEqual([
      expect.objectContaining({
        publicPath: "/assets/report.pdf",
        beforeHash: hash("old asset"),
        afterHash: hash("new asset"),
      }),
    ]);
  });

  it("compares the next approved release with an explicit last-successful-build baseline", () => {
    // Given a validated build baseline and a next release with an addition, update, withdrawal,
    // URL move, and redirect target replacement.
    const old = approved("pub_old");
    const updatedBefore = approved("pub_updated", {
      metadata: { ...approved("pub_updated").metadata, slug: "/knowledge/before" },
    });
    const updatedAfter = approved("pub_updated", {
      revisionHash: hash("new revision"),
      exposureHash: hash("new exposure"),
      metadata: { ...updatedBefore.metadata, slug: "/knowledge/after" },
    });
    const baseline: LastBuildBaseline = {
      available: true,
      publications: [old, updatedBefore],
      redirects: [{ from: "/old", to: "/knowledge/before", status: 301 }],
    };
    const redirects: readonly PublicRedirect[] = [
      { from: "/old", to: "/knowledge/after", status: 301 },
      { from: "/new-alias", to: "/knowledge/after", status: 301 },
    ];

    // When active approvals are compared to the last successful build.
    const result = createChangePlan({
      working: [],
      approved: [updatedAfter, approved("pub_added")],
      diagnostics: [],
      redirects,
      lastBuild: baseline,
    });

    // Then release-only statuses and redirect changes are explicit and deterministic.
    expect(result.release.baseline).toBe("last-successful-build");
    expect(result.release.available).toBe(true);
    if (!result.release.available) throw new TypeError("Expected available release comparison");
    expect(result.release.summary).toEqual({ added: 1, updated: 1, unchanged: 0, withdrawn: 1 });
    expect(result.release.publications.map(({ publicId, status }) => [publicId, status])).toEqual([
      ["pub_added", "added"],
      ["pub_old", "withdrawn"],
      ["pub_updated", "updated"],
    ]);
    expect(result.release.redirects).toEqual({
      added: [{ from: "/new-alias", to: "/knowledge/after", status: 301 }],
      removed: [],
      updated: [
        {
          from: "/old",
          before: { from: "/old", to: "/knowledge/before", status: 301 },
          after: { from: "/old", to: "/knowledge/after", status: 301 },
        },
      ],
    });
  });

  it("marks release comparison unavailable when no trustworthy build baseline exists", () => {
    // Given active approvals without a valid build receipt and matching staging policy.
    // When the change plan is created, then it does not invent an empty deployed site.
    const result = createChangePlan({
      working: [],
      approved: [approved("pub_active")],
      diagnostics: [],
      redirects: [],
      lastBuild: { available: false, reason: "stale-staging-policy" },
    });

    expect(result.release).toEqual({
      baseline: "last-successful-build",
      available: false,
      reason: "stale-staging-policy",
    });
  });
});
