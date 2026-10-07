import type { pepatype } from "../type/index.js";

/**
 * Create a new `Position` at the given `line`, `column`, and byte `offset`.
 *
 * Mirrors `Position::new` from the Rust implementation.
 */
export function position(line: number, column: number, offset: number): pepatype.Position {
  return { line, column, offset };
}

/** Create a new `Span` from `start` (inclusive) to `end` (exclusive). */
export function span(start: pepatype.Position, end: pepatype.Position): pepatype.Span {
  return { start, end };
}

/** The default position — the very start of the document `(0, 0, 0)`. */
export function defaultPosition(): pepatype.Position {
  return { line: 0, column: 0, offset: 0 };
}

/** The default span — both ends pointing at the document start. */
export function defaultSpan(): pepatype.Span {
  return { start: defaultPosition(), end: defaultPosition() };
}

/** UTF-8 encoded byte length of a single Unicode code point. */
export function utf8Length(c: string): number {
  const cp = c.codePointAt(0)!;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** Total UTF-8 encoded byte length of a string. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (const c of s) {
    n += utf8Length(c);
  }
  return n;
}
