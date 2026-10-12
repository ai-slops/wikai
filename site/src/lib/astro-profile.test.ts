import { describe, expect, it } from "vitest";
import { categoryLabel, categoryViews, displayTags } from "./astro-profile.ts";

const page = (id: string, title: string, tags: readonly string[], listed = true) => ({
  metadata: { id, title, tags, listed },
});

describe("Astro category views", () => {
  it("derives a unique hierarchy from listed pages under the exact category root", () => {
    // Given listed pages with overlapping category paths, an ordinary tag, and a category-like prefix.
    const pages = [
      page("pub_ts", "TypeScript", ["category/programming/typescript", "language"]),
      page("pub_react", "React", ["category/programming/react", "categoryx/private"]),
      page("pub_multi", "Full stack", ["category/programming/typescript", "category/web"]),
      page("pub_hidden", "Hidden draft", ["category/programming"], false),
    ];

    // When the Astro adapter interprets the approved tags.
    const views = categoryViews(pages);

    // Then routes are hierarchical, counts are page-unique, and non-category prefixes are excluded.
    expect(views.map(({ route }) => route)).toEqual([
      "/categories",
      "/categories/programming",
      "/categories/programming/react",
      "/categories/programming/typescript",
      "/categories/web",
    ]);
    expect(views.find(({ route }) => route === "/categories/programming")?.pages).toHaveLength(3);
    expect(views.some(({ route }) => route.includes("categoryx"))).toBe(false);
  });

  it("hides the category root in labels while preserving ordinary tags", () => {
    // Given category and ordinary tags, when labels are prepared, then only the adapter prefix is hidden.
    expect(categoryLabel("category/programming/typescript")).toBe("programming / typescript");
    expect(
      displayTags(["category/programming/typescript", "language", "categoryx/private"]),
    ).toEqual([
      { label: "programming / typescript", href: "/categories/programming/typescript" },
      { label: "language" },
      { label: "categoryx/private" },
    ]);
  });
});
