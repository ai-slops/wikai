import type { Hono } from "hono";
import { z } from "zod";
import {
  ApplySourceUpdateSchema,
  ApproveSchema,
  AssetInspectionQuerySchema,
  CandidateSchema,
  ComponentApprovalApplySchema,
  ExtractSchema,
  MetadataUpdateSchema,
  ModeSchema,
  ProjectSchema,
  PublicIdSchema,
  RestoreSchema,
  SourceUpdateQuerySchema,
  TagFilterQuerySchema,
  TagRenameApplyRequestSchema,
  TagRenamePlanSchema,
  WithdrawSchema,
} from "./api-schemas.ts";
import { previewHtml } from "./preview.ts";
import type { PublisherPort } from "./server.ts";

const PreviewQuerySchema = z.object({ mode: ModeSchema, publicId: PublicIdSchema.optional() });
const PublicationPreviewQuerySchema = z.object({ mode: ModeSchema });
const StatusResultSchema = z
  .object({ diagnostics: z.array(z.unknown()), publications: z.array(z.unknown()) })
  .passthrough();
const DiffRevisionSchema = z
  .object({
    metadata: z.unknown(),
    markdown: z.string(),
    outgoingLinks: z.array(z.unknown()),
    assets: z.array(z.unknown()),
  })
  .passthrough();
const DiffDetailSchema = z.object({
  working: DiffRevisionSchema.nullable(),
  approved: DiffRevisionSchema.nullable(),
});

async function jsonBody(request: Request): Promise<unknown> {
  return request.json();
}

export function registerApiRoutes(app: Hono, publisher: PublisherPort, csrfToken: string): void {
  app.get("/api/v1/session", (context) => context.json({ csrfToken }));
  app.get("/api/v1/status", async (context) => context.json(await publisher.status()));
  app.get("/api/v1/publications", async (context) => context.json(await publisher.status()));
  app.get("/api/v1/diagnostics", async (context) => {
    const status = StatusResultSchema.parse(await publisher.status());
    return context.json({ diagnostics: status.diagnostics });
  });
  app.get("/api/v1/plan", async (context) => context.json(await publisher.plan()));
  app.get("/api/v1/tags", async (context) => context.json(await publisher.tagList()));
  app.get("/api/v1/tags/tree", async (context) => context.json(await publisher.tagTree()));
  app.get("/api/v1/tags/filter", async (context) => {
    const input = TagFilterQuerySchema.parse(context.req.query());
    return context.json(await publisher.filterByTags(input));
  });
  app.get("/api/v1/components/plan", async (context) =>
    context.json(await publisher.planComponentUpdateApproval()),
  );
  app.get("/api/v1/assets/inspect", async (context) => {
    const query = AssetInspectionQuerySchema.parse(context.req.query());
    return context.json(await publisher.inspectAsset(query.path));
  });
  app.get("/api/v1/publications/:publicId", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    return context.json(await publisher.detail(publicId));
  });
  app.get("/api/v1/preview", async (context) => {
    const query = PreviewQuerySchema.parse(context.req.query());
    return context.json({ html: previewHtml(await publisher.preview(query.mode, query.publicId)) });
  });
  app.get("/api/v1/publications/:publicId/preview", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const query = PublicationPreviewQuerySchema.parse(context.req.query());
    return context.json({ html: previewHtml(await publisher.preview(query.mode, publicId)) });
  });
  app.get("/api/v1/publications/:publicId/diff", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const publication = DiffDetailSchema.parse(await publisher.detail(publicId));
    return context.json({
      metadata: {
        working: publication.working?.metadata ?? null,
        approved: publication.approved?.metadata ?? null,
      },
      markdown: {
        working: publication.working?.markdown ?? null,
        approved: publication.approved?.markdown ?? null,
      },
      outgoingLinks: {
        working: publication.working?.outgoingLinks ?? [],
        approved: publication.approved?.outgoingLinks ?? [],
      },
      assets: {
        working: publication.working?.assets ?? [],
        approved: publication.approved?.assets ?? [],
      },
    });
  });
  app.get("/api/v1/publications/:publicId/source-update", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = SourceUpdateQuerySchema.parse(context.req.query());
    return context.json(await publisher.sourceUpdate(publicId, input));
  });
  app.post("/api/v1/publications/:publicId/source-update", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = ApplySourceUpdateSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.applySourceUpdate(publicId, input));
  });
  app.post("/api/v1/publications/:publicId/approve", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = ApproveSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.approve(publicId, input.expectedHash));
  });
  app.post("/api/v1/publications/:publicId/withdraw", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = WithdrawSchema.parse(await jsonBody(context.req.raw));
    await publisher.withdraw(publicId, input.expectedHash, input.redirect);
    return context.json({ publicId, withdrawn: true });
  });
  app.patch("/api/v1/publications/:publicId/metadata", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = MetadataUpdateSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.updateMetadata(publicId, input.patch, input.expectedHash));
  });
  app.post("/api/v1/candidates", async (context) => {
    const input = CandidateSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.candidate(input));
  });
  app.post("/api/v1/projects", async (context) => {
    const input = ProjectSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.project(input));
  });
  app.post("/api/v1/projections", async (context) => {
    const input = ProjectSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.project(input));
  });
  app.post("/api/v1/extractions", async (context) => {
    const input = ExtractSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.extract(input));
  });
  app.post("/api/v1/extract", async (context) => {
    const input = ExtractSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.extract(input));
  });
  app.post("/api/v1/build", async (context) => context.json(await publisher.build()));
  app.post("/api/v1/tags/rename/plan", async (context) => {
    const input = TagRenamePlanSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.planTagRename(input));
  });
  app.post("/api/v1/tags/rename/apply", async (context) => {
    const input = TagRenameApplyRequestSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.applyTagRename(input));
  });
  app.post("/api/v1/components/approve", async (context) => {
    const input = ComponentApprovalApplySchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.applyComponentUpdateApproval(input.expectedPlanHash));
  });
  app.post("/api/v1/publications/:publicId/restore", async (context) => {
    const publicId = PublicIdSchema.parse(context.req.param("publicId"));
    const input = RestoreSchema.parse(await jsonBody(context.req.raw));
    return context.json(await publisher.restore(publicId, input.revisionHash, input.expectedHash));
  });
}
