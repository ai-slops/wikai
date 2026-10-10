import type { SourceRange } from "../model/index.ts";

type Point = {
  readonly line: number;
  readonly column: number;
};

export type Position = {
  readonly start: Point;
  readonly end: Point;
};

export function positionFromSourceRange(range: SourceRange | undefined): Position | undefined {
  return range === undefined
    ? undefined
    : {
        start: { line: range.startLine, column: range.startColumn },
        end: { line: range.endLine, column: range.endColumn },
      };
}

export type Positioned = {
  readonly position?: Position | undefined;
};

export function sourceRange(positioned: Positioned): SourceRange | undefined {
  const position = positioned.position;
  return position === undefined
    ? undefined
    : {
        startLine: position.start.line,
        startColumn: position.start.column,
        endLine: position.end.line,
        endColumn: position.end.column,
      };
}

function advance(point: Point, text: string): Point {
  const lines = text.split("\n");
  if (lines.length === 1) return { line: point.line, column: point.column + text.length };
  return { line: point.line + lines.length - 1, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function textSourceRange(
  node: Positioned & { readonly value: string },
  start: number,
  end: number,
): SourceRange | undefined {
  const origin = node.position?.start;
  if (origin === undefined) return undefined;
  const rangeStart = advance(origin, node.value.slice(0, start));
  const rangeEnd = advance(rangeStart, node.value.slice(start, end));
  return {
    startLine: rangeStart.line,
    startColumn: rangeStart.column,
    endLine: rangeEnd.line,
    endColumn: rangeEnd.column,
  };
}

function pointAtOffset(source: string, offset: number): Point {
  let line = 1;
  let column = 1;
  const start = source.startsWith("\ufeff") ? 1 : 0;
  for (let index = start; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function offsetSourceRange(source: string, start: number, end: number): SourceRange {
  const rangeStart = pointAtOffset(source, start);
  const rangeEnd = pointAtOffset(source, end);
  return {
    startLine: rangeStart.line,
    startColumn: rangeStart.column,
    endLine: rangeEnd.line,
    endColumn: rangeEnd.column,
  };
}

export function shiftSourceRange(range: SourceRange, source: string, offset: number): SourceRange {
  const origin = pointAtOffset(source, offset);
  return {
    startLine: origin.line + range.startLine - 1,
    startColumn: range.startLine === 1 ? origin.column + range.startColumn - 1 : range.startColumn,
    endLine: origin.line + range.endLine - 1,
    endColumn: range.endLine === 1 ? origin.column + range.endColumn - 1 : range.endColumn,
  };
}
