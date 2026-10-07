/**
 * GFM table parsing helpers.
 */
import { defaultSpan } from "./span.js";
import type { pepatype } from "../type/index.js";
import { parseInlineWithHooks } from "./inline.js";
import type { ParseHooks } from "./hooks.js";

/**
 * Returns `true` when `line` is a GFM table delimiter row — cells that
 * contain only `-` and `:` with at least one `-` per cell, optionally
 * surrounded by pipes: `| :--- | :---: | ---: |`.
 *
 * Leading/trailing whitespace and pipes are ignored; every cell must be
 * non-empty.
 */
export function isTableDelimiter(line: string): boolean {
  const stripped = line.trim();
  if (stripped === "") {
    return false;
  }
  // remove leading/trailing pipe
  let s = stripped.startsWith("|") ? stripped.slice(1) : stripped;
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }

  const cells = s.split("|");
  if (cells.length === 0) {
    return false;
  }
  return cells.every((c) => {
    const t = c.trim();
    return t !== "" && /^[:-]+$/.test(t) && t.includes("-");
  });
}

/**
 * Check whether a line could be the start of a GFM table.
 * A table requires at least one pipe `|` on the current line and a
 * delimiter row (consisting of `-`, `:`, `|`, and whitespace) on the
 * next line.
 */
export function isTableStart(lines: readonly string[], pos: number): boolean {
  if (pos + 1 >= lines.length) {
    return false;
  }
  const header = lines[pos] as string;
  const delimiter = lines[pos + 1] as string;
  return header.includes("|") && isTableDelimiter(delimiter);
}

/**
 * Parse a delimiter row into column alignments.
 *
 * Each cell maps to one `TableCellAlignment`: `:---` → left, `:---:` →
 * center, `---:` → right, and `---` (no colons) → default.
 */
export function parseDelimiterAlignments(line: string): pepatype.TableCellAlignment[] {
  const stripped = line.trim();
  let s = stripped.startsWith("|") ? stripped.slice(1) : stripped;
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }

  return s.split("|").map((cell): pepatype.TableCellAlignment => {
    const t = cell.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return "default";
  });
}

/**
 * Split a table row into raw cell strings (pipes removed, leading/trailing
 * whitespace trimmed).
 *
 * Leading and trailing pipes are optional.
 */
export function splitTableRow(line: string): string[] {
  const stripped = line.trim();
  let s = stripped.startsWith("|") ? stripped.slice(1) : stripped;
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }
  return s.split("|").map((c) => c.trim());
}

/**
 * Build a `Table` block from lines `[headerLine, delimiterLine, ...bodyLines]`.
 *
 * Header and body cells are parsed as inline content with the given options
 * and hooks (so inline hooks apply inside table cells).
 */
export function buildTable(
  headerLine: string,
  _delimiterLine: string,
  alignments: pepatype.TableCellAlignment[],
  bodyLines: readonly string[],
  options?: pepatype.AstOptions,
  hooks?: ParseHooks,
): pepatype.Block {
  const headerCells = splitTableRow(headerLine);
  const header: pepatype.TableRow = {
    cells: headerCells.map((c): pepatype.TableCell => ({
      children: parseInlineWithHooks(c, options, undefined, hooks),
    })),
  };

  const rows: pepatype.TableRow[] = bodyLines.map((line) => {
    const cells = splitTableRow(line);
    return {
      cells: cells.map((c): pepatype.TableCell => ({
        children: parseInlineWithHooks(c, options, undefined, hooks),
      })),
    };
  });

  const table: pepatype.Table = { header, rows, alignments };
  return {
    type: "table",
    table,
    attrs: undefined,
    pos: defaultSpan(),
  };
}
