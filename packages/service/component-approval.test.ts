import { expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import type { ApprovedRevision, MdxSnapshot, WorkingPublication } from "../model/index.ts";
import { workingPublication } from "../state/test-fixture.ts";
import { createComponentUpdateApprovalPlan } from "./component-plan.ts";

const mdx = (content: string, profile: string, artifact = profile): MdxSnapshot => ({
  schemaVersion: 1,
  contentInputHash: hash(content),
  profileDigest: hash(profile),
  runtime: { image: "wikai-mdx:local", lockHash: hash("lock"), runtimeHash: hash("runtime") },
  dependencies: [
    {
      path: "public-components/Card.tsx",
      hash: hash(profile),
      mime: "text/javascript; charset=utf-8",
      bytes: Buffer.byteLength(profile),
      data: Buffer.from(profile).toString("base64"),
    },
  ],
  artifact: {
    html: {
      path: "index.html",
      hash: hash(artifact),
      mime: "text/html; charset=utf-8",
      bytes: Buffer.byteLength(artifact),
      data: Buffer.from(artifact).toString("base64"),
    },
    scripts: [
      {
        path: "client.js",
        hash: hash(artifact),
        mime: "text/javascript; charset=utf-8",
        bytes: Buffer.byteLength(artifact),
        data: Buffer.from(artifact).toString("base64"),
      },
    ],
    styles: [],
  },
});

const working = (publicId: string, overrides: Partial<WorkingPublication> = {}) =>
  workingPublication({
    publicId,
    sourceId: `prv_${publicId.slice(4)}`,
    sourcePath: `${publicId}.mdx`,
    workflowStatus: "published",
    metadata: {
      ...workingPublication().metadata,
      id: publicId,
      slug: `/knowledge/${publicId.slice(4)}`,
    },
    markdown: "<Card />",
    html: "<div>old generated output</div>",
    mdx: mdx("<Card />", "new profile"),
    exposureHash: hash(`${publicId}:new exposure`),
    ...overrides,
  });

const approved = (publication: WorkingPublication): ApprovedRevision => ({
  publicId: publication.publicId,
  revisionHash: hash(`${publication.publicId}:revision`),
  exposureHash: hash(`${publication.publicId}:old exposure`),
  metadata: { ...publication.metadata, publishedAt: "2026-01-01T00:00:00.000Z" },
  markdown: publication.markdown,
  html: "<div>old generated output</div>",
  outgoingLinks: publication.outgoingLinks,
  assets: publication.assets,
  approvedAt: "2026-01-01T00:00:00.000Z",
  mdx: mdx("<Card />", "old profile"),
});

it("selects only shared-profile-only MDX updates and reports every other pending reason", () => {
  // Given one eligible update and pending publications covering every unsafe change class.
  const eligible = working("pub_eligible", { html: "<div>new generated output</div>" });
  const body = working("pub_body", { markdown: "Changed body" });
  const metadata = working("pub_metadata", {
    metadata: { ...working("pub_metadata").metadata, summary: "Changed summary" },
  });
  const tags = working("pub_tags", {
    metadata: { ...working("pub_tags").metadata, tags: ["changed"] },
  });
  const asset = working("pub_asset", {
    assets: [
      {
        publicPath: "/asset.txt",
        hash: hash("new asset"),
        mime: "text/plain",
        bytes: 9,
        data: Buffer.from("new asset").toString("base64"),
        reviewed: true,
      },
    ],
  });
  const link = working("pub_link", {
    outgoingLinks: [{ publicId: "pub_target", slug: "/knowledge/target", title: "Target" }],
  });
  const authoredMdx = working("pub_authored", { mdx: mdx("<Changed />", "new profile") });
  const blocked = working("pub_blocked");
  const firstTime = working("pub_first_time");
  const newMdx = working("pub_new_mdx");
  const orphan = working("pub_orphan");
  const publications = [
    eligible,
    body,
    metadata,
    tags,
    asset,
    link,
    authoredMdx,
    blocked,
    firstTime,
    newMdx,
  ];
  const approvedPublications = [
    eligible,
    body,
    metadata,
    tags,
    asset,
    link,
    authoredMdx,
    blocked,
  ].map((publication) => approved(working(publication.publicId)));
  approvedPublications.push({ ...approved(newMdx), mdx: undefined });
  approvedPublications.push(approved(orphan));

  // When a component-update approval plan is built.
  const plan = createComponentUpdateApprovalPlan({
    working: publications,
    approved: approvedPublications,
    diagnostics: [
      { code: "BLOCKED", severity: "error", message: "blocked", publicId: blocked.publicId },
    ],
    sourceDriftIds: ["pub_link"],
  });

  // Then only the profile-only update is eligible, even though generated output changed.
  expect(plan.eligible.map((item) => item.publicId)).toEqual([eligible.publicId]);
  expect(plan.eligible[0]).toMatchObject({
    activeRevisionHash: approved(eligible).revisionHash,
    activeExposureHash: approved(eligible).exposureHash,
    desiredExposureHash: eligible.exposureHash,
    contentInputHash: eligible.mdx?.contentInputHash,
    desiredProfileDigest: eligible.mdx?.profileDigest,
  });
  expect(
    Object.fromEntries(plan.skipped.map((item) => [item.publicId, item.reasons])),
  ).toMatchObject({
    pub_body: expect.arrayContaining(["body-changed"]),
    pub_metadata: expect.arrayContaining(["metadata-changed"]),
    pub_tags: expect.arrayContaining(["tags-changed"]),
    pub_asset: expect.arrayContaining(["assets-changed"]),
    pub_link: expect.arrayContaining(["links-changed", "source-drift"]),
    pub_authored: expect.arrayContaining(["authored-mdx-changed"]),
    pub_blocked: expect.arrayContaining(["blocked"]),
    pub_first_time: expect.arrayContaining(["unapproved-first-time"]),
    pub_new_mdx: expect.arrayContaining(["new-mdx"]),
    pub_orphan: expect.arrayContaining(["orphaned"]),
  });
  expect(plan.planHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

it("allows managed and private-only source metadata changes without classifying a mixed public update", () => {
  // Given stable public inputs with a changed source hash and managed timestamps.
  const current = working("pub_private", { sourceHash: hash("private-only source edit") });
  const previous = {
    ...approved(current),
    metadata: {
      ...approved(current).metadata,
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  };

  // When eligibility is evaluated without relevant source drift.
  const plan = createComponentUpdateApprovalPlan({
    working: [current],
    approved: [previous],
    diagnostics: [],
    sourceDriftIds: [],
  });

  // Then the profile-only publication remains eligible and pins the current source hash.
  expect(plan.eligible).toHaveLength(1);
  expect(plan.eligible[0]?.sourceHash).toBe(current.sourceHash);
});
