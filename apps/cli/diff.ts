import { diffLines } from "diff";
import type { PublicMetadata } from "../../packages/model/index.ts";
import type { PublicationDetail } from "../../packages/service/index.ts";

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function visibleMetadata(value: PublicMetadata | undefined) {
  if (!value) return null;
  const {
    publishedAt: _publishedAt,
    updatedAt: _updatedAt,
    lastReviewedAt: _lastReviewedAt,
    ...metadata
  } = value;
  return metadata;
}

export function publicationDiff(detail: PublicationDetail) {
  const approved = detail.approved;
  const working = detail.working;
  return {
    metadata: diffLines(
      serialized(visibleMetadata(approved?.metadata)),
      serialized(visibleMetadata(working?.metadata)),
    ),
    markdown: diffLines(approved?.markdown ?? "", working?.markdown ?? ""),
    html: diffLines(approved?.html ?? "", working?.html ?? ""),
    links: diffLines(
      serialized(approved?.outgoingLinks ?? []),
      serialized(working?.outgoingLinks ?? []),
    ),
    assets: diffLines(
      serialized(approved?.assets.map(({ data: _data, ...asset }) => asset) ?? []),
      serialized(working?.assets.map(({ data: _data, ...asset }) => asset) ?? []),
    ),
    sourceDrift: detail.sourceDrift,
  };
}

export function markdownDiff(detail: PublicationDetail): string {
  const changes = publicationDiff(detail);
  const sections = [
    ["Content", changes.markdown],
    ["Metadata", changes.metadata],
    ["Links", changes.links],
    ["Assets", changes.assets],
  ] as const;
  return (
    sections
      .map(
        ([title, parts]) =>
          `## ${title}\n\n\`\`\`diff\n${parts
            .map((part) =>
              part.value
                .split("\n")
                .filter(Boolean)
                .map((line) => `${part.added ? "+" : part.removed ? "-" : " "} ${line}`)
                .join("\n"),
            )
            .join("\n")}\n\`\`\``,
      )
      .join("\n\n") + `\n\nSource drift: ${detail.sourceDrift ? "yes" : "no"}\n`
  );
}
