import { hash } from "../fs/index.ts";
import type { WorkingPublication } from "../model/index.ts";

export function workingPublication(
  overrides: Partial<WorkingPublication> = {},
): WorkingPublication {
  return {
    publicId: "pub_note",
    sourceId: "prv_note",
    sourcePath: "note.md",
    sourceHash: hash("private source"),
    sourceMode: "mirror",
    workflowStatus: "review",
    metadata: {
      id: "pub_note",
      kind: "knowledge",
      slug: "/knowledge/note",
      title: "Note",
      tags: [],
      aliases: ["/knowledge/old-note"],
      featured: false,
      listed: true,
      index: true,
      feed: true,
    },
    markdown: "Public content.",
    html: "<p>Public content.</p>",
    outgoingLinks: [],
    assets: [],
    sources: [],
    exposureHash: hash("public exposure"),
    diagnostics: [],
    ...overrides,
  };
}
