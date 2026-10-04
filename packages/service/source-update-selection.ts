import type { PrivateDocument, PublicKind, SourceReference } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { extractSelection, locateLineSelection } from "./selection.ts";
import type { SourceUpdateInput } from "./source-update-schema.ts";

export function sourceUpdateSelection(context: {
  readonly source: PrivateDocument;
  readonly reference: SourceReference;
  readonly input: SourceUpdateInput;
  readonly kind: PublicKind;
  readonly projectionPath: string;
}): { readonly body: string; readonly reference: SourceReference } {
  const { source, reference, input } = context;
  const base = { path: source.sourcePath, to: context.projectionPath, kind: context.kind };
  let selector: {
    heading?: string;
    block?: string;
    lines?: string | { start: number; end: number };
  } = {};
  if (input.heading !== undefined || input.block !== undefined || input.lines !== undefined) {
    selector = {
      ...(input.heading === undefined ? {} : { heading: input.heading }),
      ...(input.block === undefined ? {} : { block: input.block }),
      ...(input.lines === undefined ? {} : { lines: input.lines }),
    };
  } else if (reference.selection !== undefined) {
    switch (reference.selection.kind) {
      case "heading":
        selector = { heading: reference.selection.value };
        break;
      case "block":
        selector = { block: reference.selection.value };
        break;
      case "lines": {
        const location =
          reference.capturedHash === undefined
            ? null
            : locateLineSelection(
                source.body,
                reference.selection.lineCount,
                reference.capturedHash,
              );
        if (location === null)
          throw new PublisherError(
            "SOURCE_SELECTION_REQUIRED",
            "Select the changed line content explicitly before merging",
          );
        selector = { lines: location };
        break;
      }
      default: {
        const exhaustive: never = reference.selection;
        return exhaustive;
      }
    }
  } else if (reference.anchor !== undefined) {
    if (reference.anchor.startsWith("heading:")) selector = { heading: reference.anchor.slice(8) };
    else if (reference.anchor.startsWith("block:")) selector = { block: reference.anchor.slice(6) };
    else if (
      reference.anchor.startsWith("lines:") &&
      reference.capturedHash === source.sourceHash
    ) {
      selector = { lines: reference.anchor.slice(6) };
    } else
      throw new PublisherError(
        "SOURCE_SELECTION_REQUIRED",
        "Choose a source selector before merging this reference",
      );
  } else {
    return { body: source.body, reference: { ...reference, capturedHash: source.sourceHash } };
  }
  const selected = extractSelection(source.body, { ...base, ...selector });
  return {
    body: selected.body,
    reference: {
      ...reference,
      anchor: selected.anchor,
      selection: selected.selection,
      capturedHash: selected.capturedHash,
    },
  };
}
