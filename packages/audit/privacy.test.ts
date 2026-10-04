import { describe, expect, it } from "vitest";
import type { PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { ConfigSchema } from "../model/index.ts";
import { privateMarkers, scanSensitiveText, scanText } from "./privacy.ts";

const security = (
  overrides: Partial<PublisherConfig["security"]> = {},
): PublisherConfig["security"] => ({
  denyPatterns: [],
  scanPrivateIdsInDist: true,
  scanPrivatePathsInDist: true,
  ...overrides,
});

const config = (securityOverrides: Partial<PublisherConfig["security"]> = {}): PublisherConfig =>
  ConfigSchema.parse({
    vault: { root: "/vault" },
    publisher: {
      stateDir: "/state",
      previewStagingDir: "/preview",
      releaseStagingDir: "/release",
    },
    security: security(securityOverrides),
    site: { sourceDir: "/site", distDir: "/dist" },
  });

describe("sensitive text scanning", () => {
  it("reports email, phone, and high-entropy warnings without exposing matched text", () => {
    // Given text containing common PII and an opaque high-entropy token.
    const text =
      "Contact jane@example.test at +1 (415) 555-0199 with Ab3Def7GhJ9Klm2Nop4Qrs6Tuv8Wxy0Z";

    // When it is scanned with default heuristic controls.
    const diagnostics = scanSensitiveText(text, {
      config: security(),
      sourcePath: "public.html",
      publicId: "pub_safe",
    });

    // Then warnings identify categories but never include excerpts or matched values.
    expect(diagnostics.map(({ code }) => code)).toEqual([
      "PRIVACY_EMAIL",
      "PRIVACY_PHONE",
      "PRIVACY_HIGH_ENTROPY",
    ]);
    expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("jane@example.test");
    expect(JSON.stringify(diagnostics)).not.toContain("Ab3Def7GhJ9Klm2Nop4Qrs6Tuv8Wxy0Z");
  });

  it("excludes UUIDs, hashes, and content-addressed paths from entropy warnings", () => {
    // Given identifiers expected in ordinary publication output.
    const text = [
      "550e8400-e29b-41d4-a716-446655440000",
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "/_assets/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png",
      "/assets/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp",
    ].join("\n");

    // When scanned.
    const diagnostics = scanSensitiveText(text, { config: security() });

    // Then expected public identifiers do not create entropy warnings.
    expect(diagnostics).toEqual([]);
  });

  it("keeps credentials and private identifiers as errors while heuristics are disabled", () => {
    // Given rendered output with a credential and private identifier and disabled warning heuristics.
    const publisherConfig = config({ scanPii: false, scanHighEntropy: false });
    const markers = privateMarkers(publisherConfig);

    // When the audit compatibility scanner runs.
    const diagnostics = scanText(
      "prv_internal AKIAABCDEFGHIJKLMNOP",
      "index.html",
      publisherConfig,
      markers,
      new Set(),
    );

    // Then hard policy violations remain errors.
    expect(diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual(
      expect.arrayContaining([
        { code: "AUDIT_PRIVATE_ID", severity: "error" },
        { code: "AUDIT_SECRET", severity: "error" },
      ]),
    );
  });

  it("warns for private titles while excluding titles already approved for publication", () => {
    // Given one private-only title and one title present in approved public metadata.
    const publisherConfig = config();
    const vault = {
      documents: [
        {
          sourcePath: "private.md",
          sourceHash: "sha256:private",
          raw: "",
          body: "",
          frontmatter: { title: "Private roadmap", aliases: [] },
          headings: [],
        },
        {
          sourcePath: "public.md",
          sourceHash: "sha256:public",
          raw: "",
          body: "",
          frontmatter: { title: "Public guide", aliases: [] },
          headings: [],
        },
      ],
      diagnostics: [],
    } satisfies VaultSnapshot;
    const markers = privateMarkers(publisherConfig, vault, new Set(["Public guide"]));

    // When both titles occur in rendered text.
    const diagnostics = scanText(
      "Private roadmap and Public guide",
      "index.html",
      publisherConfig,
      markers,
      new Set(),
    );

    // Then only the private-only title produces one safe warning.
    expect(diagnostics.filter(({ code }) => code === "PRIVACY_PRIVATE_TITLE")).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain("Private roadmap");
  });
});
