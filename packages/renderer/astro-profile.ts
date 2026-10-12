type TaggedPage = Readonly<{
  metadata: Readonly<{ tags: readonly string[]; listed: boolean }>;
}>;

export const ASTRO_CATEGORY_TAG_ROOT = "category";
export const ASTRO_CATEGORY_ROUTE_ROOT = "/categories";

const categoryPath = (tag: string): string | undefined => {
  const [root, ...segments] = tag.split("/");
  if (root !== ASTRO_CATEGORY_TAG_ROOT || segments.length === 0) return undefined;
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
};

export const astroCategoryRoutes = (pages: readonly TaggedPage[]): readonly string[] => {
  const routes = new Set<string>([ASTRO_CATEGORY_ROUTE_ROOT]);
  for (const page of pages) {
    if (!page.metadata.listed) continue;
    for (const tag of page.metadata.tags) {
      const path = categoryPath(tag);
      if (path === undefined) continue;
      const segments = path.split("/");
      for (let index = 1; index <= segments.length; index += 1) {
        routes.add(`${ASTRO_CATEGORY_ROUTE_ROOT}/${segments.slice(0, index).join("/")}`);
      }
    }
  }
  return [...routes].sort((left, right) => left.localeCompare(right));
};
