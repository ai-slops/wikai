import { vi } from "vitest";
import type { PublisherPort } from "./server.ts";

export const detail = {
  working: {
    publicId: "pub_alpha",
    exposureHash: "hash-working",
    html: "<h1>Working</h1>",
    markdown: "# Working",
    metadata: { title: "Working" },
    outgoingLinks: ["pub_beta"],
    assets: [{ publicPath: "/asset.png" }],
  },
  approved: {
    publicId: "pub_alpha",
    exposureHash: "hash-approved",
    html: "<h1>Approved</h1>",
    markdown: "# Approved",
    metadata: { title: "Approved" },
    outgoingLinks: [],
    assets: [],
  },
  history: [],
  sourceDrift: false,
};

export function publisher(): PublisherPort {
  return {
    status: vi.fn(async () => ({
      publications: [{ publicId: "pub_alpha", title: "Alpha" }],
      diagnostics: [],
    })),
    plan: vi.fn(async () => ({ publications: [], diagnostics: [], approved: [], redirects: [] })),
    detail: vi.fn(async () => detail),
    approve: vi.fn(async () => detail),
    withdraw: vi.fn(async () => undefined),
    candidate: vi.fn(async () => detail),
    project: vi.fn(async () => detail),
    extract: vi.fn(async () => detail),
    updateMetadata: vi.fn(async () => ({
      publicId: "pub_alpha",
      path: "notes/alpha.md",
      previousHash: "source-file-hash",
      sourceHash: "updated-source-hash",
    })),
    preview: vi.fn(async () => ({ mode: "working", publications: [{ html: "<h1>Preview</h1>" }] })),
    build: vi.fn(async () => ({ distPath: "/tmp/dist" })),
    audit: vi.fn(async () => []),
    restore: vi.fn(async () => detail),
  };
}
