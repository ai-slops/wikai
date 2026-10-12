import { z } from "zod";
import { PersistedMetadataSchema } from "../model/publication.ts";
import { isCanonicalPublicRoute, publicRouteKey } from "../model/routes.ts";

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    "Path must be a safe relative path",
  );
const PublicPathSchema = z
  .string()
  .startsWith("/")
  .refine((path) => isCanonicalPublicRoute(path), "Public path must be canonical");
const FileDescriptorSchema = z.strictObject({
  artifactPath: RelativePathSchema,
  hash: HashSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
const PublicFileDescriptorSchema = FileDescriptorSchema.extend({ publicPath: PublicPathSchema });
const LinkSchema = z.strictObject({
  publicId: z.string().regex(/^pub_[A-Za-z0-9_-]+$/u),
  slug: PublicPathSchema,
  title: z.string(),
  anchor: z.string().optional(),
});
const AssetSchema = z.strictObject({
  publicPath: PublicPathSchema,
  hash: HashSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
const TagTreeNodeSchema: z.ZodType<{
  readonly path: string;
  readonly segment: string;
  readonly directCount: number;
  readonly descendantCount: number;
  readonly children: readonly unknown[];
}> = z.lazy(() =>
  z.strictObject({
    path: z.string().min(1),
    segment: z.string().min(1),
    directCount: z.number().int().nonnegative(),
    descendantCount: z.number().int().nonnegative(),
    children: z.array(TagTreeNodeSchema),
  }),
);

const MarkdownContentSchema = z.strictObject({
  type: z.literal("markdown"),
  markdown: z.string(),
  html: z.string(),
});
const MdxContentSchema = z.strictObject({
  type: z.literal("mdx"),
  runtime: z.literal("react-19"),
  markdown: z.string(),
  fallbackHtml: z.string(),
  html: FileDescriptorSchema,
  scripts: z.array(PublicFileDescriptorSchema).min(1),
  styles: z.array(PublicFileDescriptorSchema),
});

export const RendererInputSchema = z.strictObject({
  protocol: z.literal("wikai-static-renderer"),
  version: z.literal(1),
  siteUrl: z.url(),
  pages: z.array(
    z.strictObject({
      metadata: PersistedMetadataSchema,
      content: z.discriminatedUnion("type", [MarkdownContentSchema, MdxContentSchema]),
      outgoingLinks: z.array(LinkSchema),
      backlinks: z.array(LinkSchema),
      assets: z.array(AssetSchema),
    }),
  ),
  redirects: z.array(
    z.strictObject({ from: PublicPathSchema, to: PublicPathSchema, status: z.literal(301) }),
  ),
  assets: z.array(AssetSchema),
  tagTree: z.array(TagTreeNodeSchema),
});

const OutputFileSchema = z.discriminatedUnion("type", [
  z.strictObject({
    path: RelativePathSchema.refine((path) => !path.endsWith(".map"), "Source maps are forbidden"),
    hash: HashSchema,
    type: z.literal("route"),
    route: PublicPathSchema,
  }),
  z.strictObject({
    path: RelativePathSchema.refine((path) => !path.endsWith(".map"), "Source maps are forbidden"),
    hash: HashSchema,
    type: z.enum(["asset", "policy"]),
  }),
]);

export const RendererOutputSchema = z
  .strictObject({
    protocol: z.literal("wikai-static-renderer"),
    version: z.literal(1),
    files: z.array(OutputFileSchema),
  })
  .superRefine((output, context) => {
    const paths = new Set<string>();
    const routes = new Set<string>();
    for (const file of output.files) {
      const pathKey = file.path.toLocaleLowerCase("en-US");
      if (paths.has(pathKey))
        context.addIssue({ code: "custom", message: "Duplicate output path" });
      paths.add(pathKey);
      if (file.type !== "route") continue;
      const routeKey = publicRouteKey(file.route);
      if (routes.has(routeKey))
        context.addIssue({ code: "custom", message: "Duplicate output route" });
      routes.add(routeKey);
    }
  });

export type RendererInput = Readonly<z.infer<typeof RendererInputSchema>>;
export type RendererOutput = Readonly<z.infer<typeof RendererOutputSchema>>;

export function routeOutputPath(route: string): string {
  const canonical = PublicPathSchema.parse(route);
  if (canonical === "/") return "index.html";
  const relative = canonical.slice(1);
  return relative.split("/").at(-1)?.includes(".") ? relative : `${relative}/index.html`;
}
