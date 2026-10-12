type TaggedPage = Readonly<{
  metadata: Readonly<{
    id: string;
    title: string;
    tags: readonly string[];
    listed: boolean;
  }>;
}>;

export type DisplayTag = Readonly<{ label: string; href?: string }>;
export type CategoryView<Page extends TaggedPage = TaggedPage> = Readonly<{
  route: string;
  path: string;
  label: string;
  pages: readonly Page[];
  children: readonly Readonly<{ route: string; label: string }>[];
}>;

const CATEGORY_TAG_ROOT = "category";
export const CATEGORY_ROUTE_ROOT = "/categories";

const categorySegments = (tag: string): readonly string[] | undefined => {
  const [root, ...segments] = tag.split("/");
  return root === CATEGORY_TAG_ROOT && segments.length > 0 ? segments : undefined;
};

const routeForSegments = (segments: readonly string[]): string =>
  `${CATEGORY_ROUTE_ROOT}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;

export const categoryLabel = (tag: string): string => {
  const segments = categorySegments(tag);
  return segments === undefined ? tag : segments.join(" / ");
};

export const displayTags = (tags: readonly string[]): readonly DisplayTag[] =>
  tags.map((tag) => {
    const segments = categorySegments(tag);
    return segments === undefined
      ? { label: tag }
      : { label: segments.join(" / "), href: routeForSegments(segments) };
  });

export const categoryViews = <Page extends TaggedPage>(
  pages: readonly Page[],
): readonly CategoryView<Page>[] => {
  const listed = pages.filter((page) => page.metadata.listed);
  const paths = new Map<string, readonly string[]>();
  for (const page of listed) {
    for (const tag of page.metadata.tags) {
      const segments = categorySegments(tag);
      if (segments === undefined) continue;
      for (let index = 1; index <= segments.length; index += 1) {
        const ancestor = segments.slice(0, index);
        paths.set(ancestor.join("/"), ancestor);
      }
    }
  }
  const views = [...paths.entries()].map(([path, segments]) => {
    const matchingPages = listed.filter((page) =>
      page.metadata.tags.some((tag) => {
        const candidate = categorySegments(tag);
        return candidate !== undefined && candidate.slice(0, segments.length).join("/") === path;
      }),
    );
    const children = [...paths.entries()]
      .filter(
        ([, candidate]) =>
          candidate.length === segments.length + 1 && candidate.slice(0, -1).join("/") === path,
      )
      .map(([, candidate]) => ({
        route: routeForSegments(candidate),
        label: candidate.at(-1) ?? "",
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    return {
      route: routeForSegments(segments),
      path,
      label: segments.join(" / "),
      pages: matchingPages,
      children,
    };
  });
  return [
    {
      route: CATEGORY_ROUTE_ROOT,
      path: "",
      label: "Categories",
      pages: listed.filter((page) =>
        page.metadata.tags.some((tag) => categorySegments(tag) !== undefined),
      ),
      children: views
        .filter(({ path }) => !path.includes("/"))
        .map(({ route, label }) => ({ route, label })),
    },
    ...views,
  ].sort((left, right) => left.route.localeCompare(right.route));
};
