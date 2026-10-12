import { describe, expect, it } from "vitest";
import { PersistedMetadataSchema, PublicSpecSchema } from "./index.ts";
import { buildTagTree, matchesTagQueries, TagPathSchema } from "./tag.ts";

const publicSpec = {
  id: "pub_tags",
  status: "review",
  mode: "mirror",
  kind: "knowledge",
  knowledge: { documentType: "topic" },
} as const;

describe("tag paths", () => {
  it("normalizes authored segment paths to NFC while retaining plain tags", () => {
    // Given decomposed Unicode and a plain tag.
    const input = { ...publicSpec, tags: ["Cafe\u0301/Notes", "plain"] };

    // When parsed.
    const parsed = PublicSpecSchema.parse(input);

    // Then canonical path strings are stored without changing case or requiring hierarchy.
    expect(parsed.tags).toEqual(["Café/Notes", "plain"]);
  });

  it.each([
    "",
    "/root",
    "root/",
    "root//leaf",
    ".",
    "root/..",
    "root\\leaf",
    "root/\u0007leaf",
    "root/\u0085leaf",
  ])("rejects structurally invalid authored tag %j", (tag) => {
    // Given an invalid path, when parsed, then authoring rejects it.
    expect(TagPathSchema.safeParse(tag).success).toBe(false);
  });

  it("keeps historical approved tags readable without rewriting them", () => {
    // Given a legacy revision whose tag is invalid for new authoring.
    const legacy = {
      id: "pub_legacy",
      kind: "knowledge",
      slug: "/knowledge/legacy",
      title: "Legacy",
      tags: ["legacy//tag", "Cafe\u0301"],
      aliases: [],
      listed: true,
      index: true,
      feed: true,
    };

    // When decoded, then its exact historical strings survive.
    expect(PersistedMetadataSchema.parse(legacy).tags).toEqual(legacy.tags);
  });

  it("matches multiple queries with explicit exact or subtree semantics", () => {
    // Given one document with hierarchical and plain tags.
    const tags = ["Engineering/Web", "Status/Stable", "plain"];

    // When queried, then every query must match and matching remains case-sensitive.
    expect(matchesTagQueries(tags, ["Engineering", "Status/Stable"], "subtree")).toBe(true);
    expect(matchesTagQueries(tags, ["Engineering", "Status/Stable"], "exact")).toBe(false);
    expect(matchesTagQueries(tags, ["engineering"], "subtree")).toBe(false);
  });

  it("infers parent nodes and direct versus descendant document counts", () => {
    // Given documents tagged only at leaves plus one directly tagged parent.
    const tree = buildTagTree([
      ["Engineering/Web/React", "Status/Stable"],
      ["Engineering/Web/Vue"],
      ["Engineering"],
    ]);

    // When built, then parents exist without being stored as authored tags.
    expect(tree).toEqual([
      {
        path: "Engineering",
        segment: "Engineering",
        directCount: 1,
        descendantCount: 3,
        children: [
          {
            path: "Engineering/Web",
            segment: "Web",
            directCount: 0,
            descendantCount: 2,
            children: [
              {
                path: "Engineering/Web/React",
                segment: "React",
                directCount: 1,
                descendantCount: 1,
                children: [],
              },
              {
                path: "Engineering/Web/Vue",
                segment: "Vue",
                directCount: 1,
                descendantCount: 1,
                children: [],
              },
            ],
          },
        ],
      },
      {
        path: "Status",
        segment: "Status",
        directCount: 0,
        descendantCount: 1,
        children: [
          {
            path: "Status/Stable",
            segment: "Stable",
            directCount: 1,
            descendantCount: 1,
            children: [],
          },
        ],
      },
    ]);
  });
});
