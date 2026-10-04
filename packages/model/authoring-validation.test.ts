import { describe, expect, it } from "vitest";
import {
  FrontmatterSchema,
  MetadataSchema,
  PersistedMetadataSchema,
  PublicSpecSchema,
} from "./index.ts";

const publicSpec = {
  id: "pub_validation",
  status: "review",
  mode: "mirror",
  kind: "knowledge",
  slug: "/knowledge/validation",
  title: "Validation",
  summary: "Boundary behavior",
  contentState: "stable",
  knowledge: { documentType: "topic" },
} as const;

describe("authoring schema validation", () => {
  it("rejects unknown keys at every configuration-owned public boundary", () => {
    // Given public metadata with unknown top-level and nested keys.
    const topLevel = PublicSpecSchema.safeParse({ ...publicSpec, privateNote: "hidden" });
    const nested = PublicSpecSchema.safeParse({
      ...publicSpec,
      knowledge: { ...publicSpec.knowledge, privateNote: "hidden" },
    });

    // When parsed, then neither unknown key is silently discarded.
    expect(topLevel.success).toBe(false);
    expect(nested.success).toBe(false);
  });

  it("rejects metadata blocks belonging to another kind", () => {
    // Given a knowledge publication carrying a work block.
    const result = PublicSpecSchema.safeParse({
      ...publicSpec,
      work: { role: "Engineer", projectStatus: "active" },
    });

    // When parsed, then the foreign block fails the authoring boundary.
    expect(result.success).toBe(false);
  });

  it.each([
    [
      "work start date",
      { ...publicSpec, kind: "work", knowledge: undefined, work: { startedAt: "2026-02-30" } },
    ],
    [
      "knowledge verification date",
      { ...publicSpec, knowledge: { documentType: "topic", lastVerifiedAt: "yesterday" } },
    ],
    [
      "log occurrence timestamp",
      { ...publicSpec, kind: "log", knowledge: undefined, log: { occurredAt: "2026-01-01" } },
    ],
  ])("rejects a non-semantic ISO %s", (_case, input) => {
    // Given an impossible or incorrectly shaped date value, when parsed, then it is rejected.
    expect(PublicSpecSchema.safeParse(input).success).toBe(false);
  });

  it("keeps arbitrary private frontmatter and legacy approved metadata compatibility", () => {
    // Given private note fields and an approved metadata record created before required authoring fields.
    const frontmatter = FrontmatterSchema.safeParse({ privateNote: "retained" });
    const approved = PersistedMetadataSchema.safeParse({
      id: "pub_legacy",
      kind: "knowledge",
      slug: "/knowledge/legacy",
      title: "Legacy",
      tags: [],
      aliases: [],
      listed: true,
      index: true,
      feed: true,
      featured: false,
      publishedAt: "first published",
      work: { startedAt: "Spring 2020" },
      legacyField: "ignored",
    });

    // When parsed, then private extensibility and historical approved records remain accepted.
    expect(frontmatter.success).toBe(true);
    expect(approved.success).toBe(true);
  });

  it("keeps authored metadata date validation strict", () => {
    const authored = MetadataSchema.safeParse({
      id: "pub_authored",
      kind: "work",
      slug: "/work/authored",
      title: "Authored",
      tags: [],
      aliases: [],
      listed: true,
      index: true,
      feed: true,
      featured: false,
      publishedAt: "first published",
      work: { startedAt: "Spring 2020" },
    });

    expect(authored.success).toBe(false);
  });
});
