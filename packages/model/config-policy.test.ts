import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./config.ts";

const input = {
  vault: { root: "/vault" },
  publisher: {
    stateDir: "/state",
    previewStagingDir: "/preview",
    releaseStagingDir: "/release",
  },
  site: { sourceDir: "/site", distDir: "/dist" },
};

describe("policy configuration", () => {
  it("accepts omitted review and privacy controls for backward compatibility", () => {
    // Given a configuration written before policy controls existed.
    // When it is parsed.
    const parsed = ConfigSchema.parse(input);

    // Then the optional controls remain absent for consumers to apply stable defaults.
    expect(parsed.review).toBeUndefined();
    expect(parsed.security.warnPrivateTitles).toBeUndefined();
    expect(parsed.security.scanPii).toBeUndefined();
    expect(parsed.security.scanHighEntropy).toBeUndefined();
  });

  it("parses per-kind review ages and disabled privacy heuristics", () => {
    // Given explicit policy overrides.
    // When they are parsed.
    const parsed = ConfigSchema.parse({
      ...input,
      review: { warnAfterDays: { work: 30, log: 0 } },
      security: { warnPrivateTitles: false, scanPii: false, scanHighEntropy: false },
    });

    // Then zero remains a valid disabling value and controls are retained.
    expect(parsed.review?.warnAfterDays?.log).toBe(0);
    expect(parsed.review?.warnAfterDays?.work).toBe(30);
    expect(parsed.security.scanPii).toBe(false);
  });

  it("parses optional named directory deployment destinations without defaults", () => {
    // Given an explicit deployment destination map.
    // When it is parsed.
    const parsed = ConfigSchema.parse({
      ...input,
      deployments: {
        production_1: {
          type: "directory",
          root: "/srv/www",
        },
      },
    });

    // Then the destination is retained and no destination is synthesized when omitted.
    expect(Object.keys(parsed.deployments ?? {})).toEqual(["production_1"]);
    expect(Object.values(parsed.deployments ?? {})[0]?.root).toBe("/srv/www");
    expect(ConfigSchema.parse(input).deployments).toBeUndefined();
  });

  it("rejects unsafe deployment names and undeclared destination fields", () => {
    // Given deployment configuration that is unsafe or not schema-declared.
    // When it is parsed.
    const unsafeName = ConfigSchema.safeParse({
      ...input,
      deployments: {
        _production: {
          type: "directory",
          root: "/srv/www",
        },
      },
    });
    const extraField = ConfigSchema.safeParse({
      ...input,
      deployments: {
        production: {
          type: "directory",
          root: "/srv/www",
          backupDir: "/srv/backups",
        },
      },
    });

    // Then neither configuration crosses the boundary.
    expect(unsafeName.success).toBe(false);
    expect(extraField.success).toBe(false);
  });

  it.each([
    ["root", { ...input, unexpected: true }],
    ["vault", { ...input, vault: { ...input.vault, unexpected: true } }],
    ["publisher", { ...input, publisher: { ...input.publisher, unexpected: true } }],
    ["site", { ...input, site: { ...input.site, unexpected: true } }],
    [
      "visibility defaults",
      { ...input, defaults: { work: { listed: true, index: true, feed: true, unexpected: true } } },
    ],
  ])("rejects an unknown %s configuration key", (_case, config) => {
    // Given an unknown key at a configuration-owned boundary, when parsed, then it is rejected.
    expect(ConfigSchema.safeParse(config).success).toBe(false);
  });
});
