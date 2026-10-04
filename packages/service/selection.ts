import { hash } from "../fs/index.ts";
import { anchoredFragments } from "../markdown/selection.ts";
import { PublisherError, type SourceReference, type SourceSelection } from "../model/index.ts";
import type { ExtractInput } from "./schema.ts";

const normalized = (body: string): string => body.replaceAll("\r\n", "\n");
const fragmentHash = (body: string): string => hash(normalized(body).trimEnd());

export function locateLineSelection(
  body: string,
  lineCount: number,
  expectedHash: string,
): { readonly start: number; readonly end: number } | null {
  const lines = normalized(body).split("\n");
  let match: { readonly start: number; readonly end: number } | null = null;
  for (let start = 0; start + lineCount <= lines.length; start += 1) {
    if (fragmentHash(lines.slice(start, start + lineCount).join("\n")) === expectedHash) {
      if (match !== null) return null;
      match = { start: start + 1, end: start + lineCount };
    }
  }
  return match;
}

export function selectedSourceHash(body: string, source: SourceReference): string | null {
  const selection = source.selection;
  if (selection === undefined) {
    throw new PublisherError("SOURCE_SELECTION_REQUIRED", "A fragment selector is required");
  }
  switch (selection.kind) {
    case "heading":
    case "block": {
      const fragments = anchoredFragments(normalized(body), selection);
      const fragment = fragments[0];
      return fragments.length === 1 && fragment !== undefined ? fragmentHash(fragment) : null;
    }
    case "lines":
      return source.capturedHash !== undefined &&
        locateLineSelection(body, selection.lineCount, source.capturedHash) !== null
        ? source.capturedHash
        : null;
    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

export function extractSelection(
  body: string,
  input: ExtractInput,
): {
  readonly body: string;
  readonly anchor: string;
  readonly capturedHash: string;
  readonly selection: SourceSelection;
} {
  const content = normalized(body);
  if (input.heading !== undefined || input.block !== undefined) {
    const selection: Exclude<SourceSelection, { readonly kind: "lines" }> =
      input.heading !== undefined
        ? { version: 1, kind: "heading", value: input.heading }
        : { version: 1, kind: "block", value: (input.block ?? "").replace(/^\^/u, "") };
    if (selection.value.length === 0) {
      throw new PublisherError("EXTRACT_BLOCK_INVALID", "Block identifier is empty");
    }
    const fragments = anchoredFragments(content, selection);
    const fragment = fragments[0];
    const code = selection.kind === "heading" ? "EXTRACT_HEADING" : "EXTRACT_BLOCK";
    if (fragment === undefined) {
      throw new PublisherError(`${code}_NOT_FOUND`, "Selection was not found");
    }
    if (fragments.length !== 1) {
      throw new PublisherError(`${code}_AMBIGUOUS`, "Selection matches more than one fragment");
    }
    return {
      body: fragment.trimEnd(),
      anchor: `${selection.kind}:${selection.value}`,
      capturedHash: fragmentHash(fragment),
      selection,
    };
  }
  const range = input.lines;
  if (range === undefined) {
    throw new PublisherError("EXTRACT_LINES_INVALID", "Line range is missing");
  }
  const [start, end] =
    typeof range === "string" ? range.split(":").map(Number) : [range.start, range.end];
  const lines = content.split("\n");
  if (
    start === undefined ||
    end === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end > lines.length
  ) {
    throw new PublisherError("EXTRACT_LINES_INVALID", "Line range is outside the source body");
  }
  const fragment = lines
    .slice(start - 1, end)
    .join("\n")
    .trimEnd();
  if (fragment.length === 0) {
    throw new PublisherError("EXTRACT_LINES_EMPTY", "Selected lines contain no content");
  }
  const capturedHash = fragmentHash(fragment);
  const lineCount = fragment.split("\n").length;
  if (locateLineSelection(content, lineCount, capturedHash) === null) {
    throw new PublisherError("EXTRACT_LINES_AMBIGUOUS", "Selected content occurs more than once");
  }
  return {
    body: fragment,
    anchor: `lines:${start}:${end}`,
    capturedHash,
    selection: { version: 1, kind: "lines", lineCount },
  };
}
