import { describe, expect, it } from "vitest";
import type { WorkingPublication } from "../model/index.ts";
import { ConfigSchema } from "../model/index.ts";
import { publicationPrivacyDiagnostics } from "./privacy.ts";

const publication = (markdown: string): WorkingPublication => ({
  publicId: "pub_example",
  sourceId: "prv_example",
  sourcePath: "example.md",
  sourceHash: "sha256:source",
  sourceMode: "mirror",
  workflowStatus: "review",
  metadata: {
    id: "pub_example",
    kind: "knowledge",
    slug: "/knowledge/example",
    title: "Example",
    tags: [],
    aliases: [],
    listed: true,
    index: true,
    feed: true,
    featured: false,
  },
  markdown,
  html: `<p>${markdown}</p>`,
  outgoingLinks: [],
  assets: [],
  sources: [],
  exposureHash: "sha256:exposure",
  diagnostics: [],
});

describe("compiler privacy diagnostics", () => {
  it("attaches safe warnings to a working publication without changing its content", () => {
    // Given a working publication containing an email address.
    const working = publication("Contact editor@example.test");
    const original = structuredClone(working);
    const config = ConfigSchema.parse({
      vault: { root: "/vault" },
      publisher: {
        stateDir: "/state",
        previewStagingDir: "/preview",
        releaseStagingDir: "/release",
      },
      security: {
        denyPatterns: [],
        scanPrivateIdsInDist: true,
        scanPrivatePathsInDist: true,
      },
      site: { sourceDir: "/site", distDir: "/dist" },
    });

    // When compiler privacy diagnostics are calculated.
    const diagnostics = publicationPrivacyDiagnostics(working, config);

    // Then content remains untouched and only a safe warning is returned.
    expect(working).toEqual(original);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "PRIVACY_EMAIL",
        severity: "warning",
        sourcePath: "example.md",
        publicId: "pub_example",
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("editor@example.test");
  });
});
