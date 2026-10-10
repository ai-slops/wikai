import type { PublicationDifferences } from "../../packages/service/change-plan.ts";
import type { PublisherPlan } from "../../packages/service/index.ts";

function summary(values: Readonly<Record<string, number>>, order: readonly string[]): string {
  return order.map((key) => `${key}=${values[key] ?? 0}`).join(" ");
}

function differenceLines(differences: PublicationDifferences | null): readonly string[] {
  if (differences === null) return [];
  const lines: string[] = [];
  const { canonical, aliases } = differences.urls;
  if (canonical.before !== canonical.after) {
    lines.push(`  url: ${canonical.before ?? "(none)"} -> ${canonical.after ?? "(none)"}`);
  }
  if (aliases.added.length > 0 || aliases.removed.length > 0) {
    lines.push(`  aliases: +${aliases.added.length} -${aliases.removed.length}`);
  }
  if (differences.metadata.changed) {
    lines.push(`  metadata: ${differences.metadata.fields.join(", ")}`);
  }
  if (differences.body.changed) {
    lines.push(
      `  body: ${differences.body.beforeHash ?? "(none)"} -> ${differences.body.afterHash ?? "(none)"}`,
    );
  }
  const links = differences.links;
  if (links.added.length > 0 || links.removed.length > 0 || links.updated.length > 0) {
    lines.push(`  links: +${links.added.length} -${links.removed.length} ~${links.updated.length}`);
  }
  const assets = differences.assets;
  if (assets.added.length > 0 || assets.removed.length > 0 || assets.updated.length > 0) {
    lines.push(
      `  assets: +${assets.added.length} -${assets.removed.length} ~${assets.updated.length}`,
    );
  }
  return lines;
}

export function renderPlan(plan: PublisherPlan): string {
  const proposalOrder = ["added", "updated", "unchanged", "blocked", "orphaned"] as const;
  const lines = [
    `Proposals vs ${plan.changes.proposals.baseline}`,
    summary(plan.changes.proposals.summary, proposalOrder),
  ];
  for (const publication of plan.changes.proposals.publications) {
    lines.push(`${publication.status.toUpperCase()} ${publication.publicId}`);
    lines.push(...differenceLines(publication.differences));
    for (const diagnostic of publication.diagnostics) {
      lines.push(`  diagnostic: ${diagnostic.code}`);
    }
  }
  const release = plan.changes.release;
  if (!release.available) {
    lines.push(`Release vs ${release.baseline}: unavailable (${release.reason})`);
    return lines.join("\n");
  }
  const releaseOrder = ["added", "updated", "unchanged", "withdrawn"] as const;
  lines.push(`Release vs ${release.baseline}`);
  lines.push(summary(release.summary, releaseOrder));
  for (const publication of release.publications) {
    lines.push(`${publication.status.toUpperCase()} ${publication.publicId}`);
    lines.push(...differenceLines(publication.differences));
  }
  lines.push(
    `Redirects: +${release.redirects.added.length} -${release.redirects.removed.length} ~${release.redirects.updated.length}`,
  );
  return lines.join("\n");
}
