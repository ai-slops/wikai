import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFHexString, PDFName } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pdfWithMetadata } from "../assets/pdf-metadata-fixture.ts";
import { StateDocumentSchema } from "../state/index.ts";
import { Publisher } from "./index.ts";
import { createServiceFixture, knowledgeSource } from "./test-fixture.ts";

let root: string;
let vault: string;
let configPath: string;

beforeEach(async () => {
  ({ root, vault, configPath } = await createServiceFixture());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writePdfWithAuthor(author: string): Promise<void> {
  await mkdir(join(vault, "public-assets"));
  const bytes = await pdfWithMetadata((_pdf, info) => {
    info.set(PDFName.of("Author"), PDFHexString.fromText(author));
  });
  await writeFile(join(vault, "public-assets", "report.pdf"), bytes);
}

describe("private inspection sensitivity policy", () => {
  it("reports sensitive extracted metadata through Publisher without copying its value", async () => {
    // Given an attachment whose bounded metadata contains an email address.
    const privateEmail = "private.author@example.test";
    await writePdfWithAuthor(privateEmail);
    const publisher = await Publisher.open(configPath);

    // When the attachment is inspected through the service.
    const report = await publisher.inspectAsset("public-assets/report.pdf");

    // Then the report includes a generic warning without echoing the sensitive value.
    expect(report.diagnostics).toContainEqual({
      code: "PRIVACY_EMAIL",
      severity: "warning",
      message: "Public text may contain an email address",
      sourcePath: "public-assets/report.pdf",
    });
    expect(JSON.stringify(report.diagnostics)).not.toContain(privateEmail);
  });

  it("honors the configured sensitive-text policy for extracted metadata", async () => {
    // Given an attachment with an email and PII scanning disabled.
    await writePdfWithAuthor("private.author@example.test");
    const publisher = await Publisher.open(configPath);
    publisher.config.security.scanPii = false;

    // When the attachment is inspected through the service.
    const report = await publisher.inspectAsset("public-assets/report.pdf");

    // Then the disabled policy does not emit a PII warning.
    expect(report.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "PRIVACY_EMAIL" }),
    );
  });
});

describe("private review-age policy", () => {
  it("projects a private review timestamp warning through plan, status and detail without changing the revision", async () => {
    // Given a current immutable approval with an independently stored, overdue private review timestamp.
    await writeFile(
      join(vault, "policy.md"),
      knowledgeSource({
        privateId: "prv_policy",
        publicId: "pub_policy",
        title: "Policy",
        slug: "/knowledge/policy",
        body: "# Policy\n\nPublic guidance.\n",
      }),
    );
    const publisher = await Publisher.open(configPath);
    const working = (await publisher.detail("pub_policy")).working;
    if (working === null) throw new TypeError("working publication missing");
    const approved = await publisher.approve("pub_policy", working.exposureHash);
    const revisionPath = join(
      root,
      "state",
      "revisions",
      approved.publicId,
      `${approved.revisionHash}.json`,
    );
    const revisionBefore = await readFile(revisionPath, "utf8");
    const statePath = join(root, "state", "state.json");
    const state = StateDocumentSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
    const publication = state.publications[approved.publicId];
    if (publication === undefined) throw new TypeError("publication state missing");
    await writeFile(
      statePath,
      JSON.stringify({
        ...state,
        publications: {
          ...state.publications,
          [approved.publicId]: { ...publication, lastReviewedAt: "2000-01-01T00:00:00.000Z" },
        },
      }),
    );

    // When each Publisher read model is requested.
    const plan = await publisher.plan();
    const status = await publisher.status();
    const detail = await publisher.detail(approved.publicId);

    // Then each surface exposes the generic warning and leaves the approved snapshot byte-identical.
    const warning = expect.objectContaining({
      code: "REVIEW_OVERDUE",
      severity: "warning",
      publicId: approved.publicId,
    });
    expect(plan.diagnostics).toContainEqual(warning);
    expect(status.diagnostics).toContainEqual(warning);
    expect(
      status.publications.find((publication) => publication.publicId === approved.publicId)
        ?.diagnostics,
    ).toContainEqual(warning);
    expect(detail.diagnostics).toContainEqual(warning);
    expect(detail.approved?.revisionHash).toBe(approved.revisionHash);
    expect(await readFile(revisionPath, "utf8")).toBe(revisionBefore);
  });
});
