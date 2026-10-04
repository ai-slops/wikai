import { PublisherError } from "../model/index.ts";

export type MarkdownSource = {
  readonly frontmatter: string;
  readonly body: string;
  readonly bom: boolean;
  readonly newline: "\n" | "\r\n";
  readonly finalNewline: boolean;
};

export function splitMarkdownSource(raw: string): MarkdownSource {
  const bom = raw.startsWith("\ufeff");
  const content = bom ? raw.slice(1) : raw;
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  const newline = first.endsWith("\r") ? "\r\n" : "\n";
  const format = { bom, newline, finalNewline: raw.endsWith("\n") } as const;
  if (first.trim() !== "---") return { ...format, frontmatter: "", body: content };
  if (first.replace(/\r$/u, "") !== "---") {
    throw new PublisherError(
      "FRONTMATTER_DELIMITER_INVALID",
      "Frontmatter delimiters must be unindented and have no trailing spaces",
    );
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/u, "") === "---");
  if (closing < 0) {
    const noncanonical = lines.slice(1).some((line) => line.trim() === "---");
    throw new PublisherError(
      noncanonical ? "FRONTMATTER_DELIMITER_INVALID" : "FRONTMATTER_UNTERMINATED",
      "Markdown frontmatter has no canonical closing delimiter",
    );
  }
  const frontmatter = lines.slice(1, closing).join("\n");
  const bodyOffset = lines
    .slice(0, closing + 1)
    .reduce((length, line) => length + line.length + 1, 0);
  return {
    ...format,
    frontmatter: frontmatter === "" ? "" : `${frontmatter}\n`,
    body: content.slice(bodyOffset),
  };
}
