/**
 * Block-level Markdown parser.
 *
 * This module implements the block-level parser that converts lines of
 * Markdown source text into `Block` nodes.  It supports:
 *
 * - ATX headings (`#` … `######`)
 * - Fenced and indented code blocks
 * - Block quotes
 * - Ordered and unordered lists (with GFM task-list markers)
 * - Thematic breaks
 * - HTML blocks and HTML comments (`<!-- ... -->`)
 * - GFM tables
 * - Link reference definitions (`[label]: url "title"`)
 * - Kramdown block attributes (`{: #id .class}`)
 *
 * The `ParserState` class holds the parser's cursor position and shared
 * context.  The `mdToAst` function creates a `ParserState` and drives it to
 * completion.
 *
 * ## Implementation note
 *
 * Byte offsets stored in `pos` spans are UTF-8 byte offsets, mirroring the
 * Rust implementation.  Line indices and columns are code-point based.
 */

import { parseAttrs } from "./attrs.js";
import { ParseHooks, finalizeHookBlock } from "./hooks.js";
import { type LinkRefMap, parseInlineWithHooks } from "./inline.js";
import { buildTable, isTableStart, parseDelimiterAlignments } from "./table.js";
import { span as mkSpan, utf8ByteLength } from "./span.js";
import type { pepatype } from "../type/index.js";

export type MdToAstWithHook<T extends Record<string, any> = {}> = (
  input: string,
  opts: pepatype.AstOptions,
  fileName: string | undefined | null,
  hooks: ParseHooks | undefined,
) => pepatype.Document<T>;

/**
 * Compute the byte offset of the start of each line.
 *
 * Line 0 always starts at offset 0.  For each `\n` in `input`, a new entry
 * is added pointing to the byte immediately after the newline.
 */
export function computeLineStarts(input: string): number[] {
  const starts: number[] = [0];
  let byte = 0;
  for (const c of input) {
    byte +=
      c.codePointAt(0)! <= 0x7f
        ? 1
        : c.codePointAt(0)! <= 0x7ff
          ? 2
          : c.codePointAt(0)! <= 0xffff
            ? 3
            : 4;
    if (c === "\n") {
      starts.push(byte);
    }
  }
  return starts;
}

/** Split `input` into lines, mirroring Rust's `str::lines()` semantics
 * (split on `\n`, strip a trailing `\r` from each line). */
// function splitLines(input: string): string[] {
//   return input.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
// }

/**
 * Internal parser state for block-level parsing.
 *
 * Holds the source text, the line slice, line-start offsets, parser
 * options, the link reference map (for resolving reference-style links
 * during inline parsing), and the custom parser hooks.
 */
export class ParserState {
  /** The full source text. */
  readonly input: string;
  /** Lines of the source text (split on `\n`). */
  readonly lines: readonly string[];
  /** Byte offset of the start of each line. */
  readonly lineStarts: readonly number[];
  /** Current line index (0-based). */
  pos = 0;
  /** Parser options. */
  readonly opts: pepatype.AstOptions;
  /** Optional file name. */
  fileName: string | undefined | null;
  /** Link reference definitions collected in the pre-pass. */
  readonly refs: LinkRefMap;
  /** Custom parser hooks (empty when none registered). */
  readonly hooks: ParseHooks | undefined;

  constructor(
    input: string,
    lines: readonly string[],
    lineStarts: readonly number[],
    opts: pepatype.AstOptions,
    fileName: string | undefined | null,
    refs: LinkRefMap,
    hooks: ParseHooks | undefined,
  ) {
    this.input = input;
    this.lines = lines;
    this.lineStarts = lineStarts;
    this.opts = opts;
    this.fileName = fileName;
    this.refs = refs;
    this.hooks = hooks;
  }

  /** Returns `true` if the parser has consumed all lines. */
  isDone(): boolean {
    return this.pos >= this.lines.length;
  }

  /** Returns the current line, or `undefined` if at end of input. */
  current(): string | undefined {
    return this.lines[this.pos];
  }

  /** Advance to the next line. */
  advance(): void {
    this.pos += 1;
  }

  /** The `Position` at the start of logical line `line` (0-based). */
  positionAt(line: number): pepatype.Position {
    line = Math.min(line, Math.max(0, this.lineStarts.length - 1));
    const offset = Math.min(this.lineStarts[line] as number, this.input.length);
    return { line, column: 0, offset };
  }

  /** Span covering lines `[from, to)` (half-open). */
  span(from: number, to: number): pepatype.Span {
    return mkSpan(this.positionAt(from), this.positionAt(to));
  }

  /** Skip blank lines. Returns `true` if at least one was consumed. */
  skipBlankLines(): boolean {
    const start = this.pos;
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (line.trim() === "") {
        this.advance();
      } else {
        break;
      }
    }
    return this.pos > start;
  }

  /**
   * Parse the current line as a block-level node.
   *
   * Returns a `Block` if a block was successfully parsed, or `undefined`
   * if no block construct matched.  Advances the parser position past
   * the consumed lines.
   */
  parseBlock(cb: MdToAstWithHook): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    const startLine = this.pos;

    // Custom parser hooks — tried before every built-in matcher so an
    // extension can both introduce new syntax and override built-ins.
    if (this.hooks !== undefined && !this.hooks.isEmpty()) {
      const hooked = this.tryHookBlock();
      if (hooked !== undefined) {
        return hooked;
      }
    }

    // GFM table
    if (this.opts.gfm && isTableStart(this.lines, this.pos)) {
      return this.parseTable(startLine);
    }

    // Thematic break
    if (isThematicBreak(line)) {
      this.advance();
      return { type: "thematic_break", pos: this.span(startLine, this.pos) };
    }

    // ATX heading
    const heading = this.tryHeading();
    if (heading !== undefined) {
      return heading;
    }

    // Fenced code block
    const fenced = this.tryFencedCode();
    if (fenced !== undefined) {
      return fenced;
    }

    // Indented code block (4+ leading spaces)
    const indented = this.tryIndentedCode();
    if (indented !== undefined) {
      return indented;
    }

    // Block quote
    if (line.trimStart().startsWith(">")) {
      return this.parseBlockQuote(cb);
    }
    // List
    if (isListMarker(line)) {
      return this.parseList(cb);
    }

    // HTML block
    if (isHtmlBlockStart(line)) {
      // HTML comment block
      if (line.trimStart().startsWith("<!--")) {
        return this.parseHtmlComment(startLine);
      }
      const html = this.collectHtmlBlock();
      const attrs = this.tryTrailingAttrs();
      return {
        type: "html_block",
        html,
        attrs,
        pos: this.span(startLine, this.pos),
      };
    }

    // Link reference definition: `[label]: url "title"`
    const refDef = this.tryLinkReferenceDefinition();
    if (refDef !== undefined) {
      return refDef;
    }

    // Default: paragraph
    return this.parseParagraph();
  }

  /**
   * Try the registered custom block hooks at the current position.
   *
   * Returns the hook-parsed block with an accurate source span and any
   * trailing Kramdown attribute block applied, or `undefined` when every
   * hook declined (in which case the built-in matchers proceed).
   */
  private tryHookBlock(): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    const ctx: pepatype.BlockParseContext = {
      line,
      lineIndex: this.pos,
      lines: this.lines.slice(this.pos),
    };
    const hooked = this.hooks!.tryParseBlock(ctx);
    if (hooked === undefined) {
      return undefined;
    }
    const [block, consumedRaw] = hooked;
    // A hook must consume at least one line; clamp defensively.
    const consumed = Math.max(1, consumedRaw);
    const endLine = Math.min(this.pos + consumed, this.lines.length);
    const pos = this.span(this.pos, endLine);
    this.pos = endLine;
    const attrs = this.tryTrailingAttrs();
    return finalizeHookBlock(block, pos, attrs);
  }

  /**
   * After parsing a block, check if the next line is a Kramdown
   * attribute block `{:...}` that applies to this block.  Blank lines
   * between the block and the attribute marker are allowed.
   */
  tryTrailingAttrs(): pepatype.Attributes | undefined {
    if (!this.opts.kramdown) {
      return undefined;
    }
    // Skip blank lines (but remember to consume them).
    let peek = this.pos;
    while (peek < this.lines.length && (this.lines[peek] as string).trim() === "") {
      peek += 1;
    }
    if (peek < this.lines.length) {
      const trimmed = (this.lines[peek] as string).trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        const parsed = parseAttrs(trimmed);
        if (parsed !== undefined) {
          // Consume the blank lines + the attribute line.
          this.pos = peek + 1;
          return parsed[0];
        }
      }
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Tables (GFM)
  // -----------------------------------------------------------------------

  private parseTable(startLine: number): pepatype.Block {
    const headerLine = this.current()!;
    const delimiterLine = this.lines[this.pos + 1] as string;
    const alignments = parseDelimiterAlignments(delimiterLine);

    this.advance(); // header
    this.advance(); // delimiter

    const bodyLines: string[] = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (line.trim() === "") {
        break;
      }
      if (!line.includes("|")) {
        break;
      }
      bodyLines.push(line);
      this.advance();
    }

    const block = buildTable(
      headerLine,
      delimiterLine,
      alignments,
      bodyLines,
      this.opts,
      this.hooks,
    );
    // Fix position + trailing attrs
    if (block.type === "table") {
      block.pos = this.span(startLine, this.pos);
      block.attrs = this.tryTrailingAttrs();
    }
    return block;
  }

  // -----------------------------------------------------------------------
  // Link Reference Definitions
  // -----------------------------------------------------------------------

  /** Try to parse a link reference definition: `[label]: url "title"` */
  private tryLinkReferenceDefinition(): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    const trimmed = line.trimStart();

    // Must start with `[`
    if (!trimmed.startsWith("[")) {
      return undefined;
    }

    // Find the closing `]`
    const afterOpen = trimmed.slice(1);
    const closeIdx = afterOpen.indexOf("]");
    if (closeIdx === -1) {
      return undefined;
    }
    const bracketClose = 1 + closeIdx; // index in trimmed

    // Must be followed by `:`
    const afterBracket = trimmed.slice(bracketClose + 1);
    if (!afterBracket.trimStart().startsWith(":")) {
      return undefined;
    }

    // Parse the label
    const labelRaw = trimmed.slice(1, bracketClose);
    if (labelRaw.trim() === "") {
      return undefined;
    }
    const label = normalizeLabel(labelRaw);

    // Everything after `:`
    const afterColon = afterBracket.trimStart().slice(1); // skip ':'
    const rest = afterColon.trimStart();

    // Parse URL — may be wrapped in `<...>` or bare
    const [url, afterUrl] = parseLinkUrl(rest);

    // Parse optional title
    const titlePart = afterUrl.trim();
    const [title] = parseLinkTitle(titlePart);

    const startLine = this.pos;
    this.advance();

    return {
      type: "link_reference_definition",
      label,
      url,
      title: title as string,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // HTML Comment
  // -----------------------------------------------------------------------

  /** Parse an HTML comment block starting with `<!--`. */
  private parseHtmlComment(startLine: number): pepatype.Block {
    let content = "";
    let foundClose = false;

    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (!foundClose) {
        content += line;
        content += "\n";
        if (line.includes("-->")) {
          foundClose = true;
          this.advance();
          break;
        }
        this.advance();
      } else {
        break;
      }
    }

    // If we never found -->, keep consuming until blank line (HTML block
    // condition)
    if (!foundClose) {
      while (this.pos < this.lines.length) {
        const line = this.lines[this.pos] as string;
        if (line.trim() === "") {
          break;
        }
        content += line;
        content += "\n";
        this.advance();
      }
    }

    // Strip the `<!--` prefix and `-->` suffix to extract the comment value
    const value = extractCommentContent(content);

    return { type: "comment", value, pos: this.span(startLine, this.pos) };
  }

  // -----------------------------------------------------------------------
  // Headings
  // -----------------------------------------------------------------------

  private tryHeading(): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    const startLine = this.pos;
    const trimmed = line.trimStart();
    let hashes = 0;
    for (const c of trimmed) {
      if (c === "#") {
        hashes += 1;
      } else {
        break;
      }
    }
    if (hashes === 0 || hashes > 6) {
      return undefined;
    }
    const rest = trimmed.slice(hashes);
    if (rest !== "" && !rest.startsWith(" ")) {
      return undefined;
    }
    const text = rest.trim();
    this.advance();

    // Kramdown: block attribute marker on the next line:
    //   # Title
    //   {: #id .cls key="val"}
    const headingText = text;
    const attrs = this.tryTrailingAttrs();

    const children = parseInlineWithHooks(headingText, this.opts, this.refs, this.hooks);
    return {
      type: "heading",
      level: hashes,
      children,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // Fenced code
  // -----------------------------------------------------------------------

  private tryFencedCode(): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    const trimmed = line.trimStart();
    const fenceChar = trimmed[0];
    if (fenceChar !== "`" && fenceChar !== "~") {
      return undefined;
    }
    let fenceLen = 0;
    for (const c of trimmed) {
      if (c === fenceChar) {
        fenceLen += 1;
      } else {
        break;
      }
    }
    if (fenceLen < 3) {
      return undefined;
    }
    const info = trimmed.slice(fenceLen).trim();
    const lang = info === "" ? undefined : info;

    const startLine = this.pos;
    this.advance();
    let code = "";
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos] as string;
      const lt = l.trimStart();
      let ltFence = 0;
      for (const c of lt) {
        if (c === fenceChar) {
          ltFence += 1;
        } else {
          break;
        }
      }
      if (lt.startsWith(fenceChar) && ltFence >= fenceLen) {
        this.advance();
        break;
      }
      code += l;
      code += "\n";
      this.advance();
    }
    if (code.endsWith("\n")) {
      code = code.slice(0, -1);
    }

    const attrs = this.tryTrailingAttrs();
    return {
      type: "code_block",
      lang,
      code,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // Indented code
  // -----------------------------------------------------------------------

  private tryIndentedCode(): pepatype.Block | undefined {
    const line = this.current();
    if (line === undefined) {
      return undefined;
    }
    if (!(line.startsWith("    ") || line.startsWith("\t"))) {
      return undefined;
    }

    const startLine = this.pos;
    let code = "";
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos] as string;
      if (l.trim() === "") {
        if (
          this.pos + 1 < this.lines.length &&
          ((this.lines[this.pos + 1] as string).startsWith("    ") ||
            (this.lines[this.pos + 1] as string).startsWith("\t"))
        ) {
          code += "\n";
          this.advance();
          continue;
        } else {
          break;
        }
      }
      if (l.startsWith("    ")) {
        code += l.slice(4);
      } else if (l.startsWith("\t")) {
        code += l.slice(1);
      } else {
        break;
      }
      code += "\n";
      this.advance();
    }
    if (code.endsWith("\n")) {
      code = code.slice(0, -1);
    }

    const attrs = this.tryTrailingAttrs();
    return {
      type: "code_block",
      lang: undefined,
      code,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // Block quote
  // -----------------------------------------------------------------------

  private parseBlockQuote(cb: MdToAstWithHook): pepatype.Block {
    const startLine = this.pos;
    const inner: string[] = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      const trimmed = line.trimStart();
      if (trimmed.startsWith(">")) {
        const rest = trimmed.slice(1);
        inner.push(rest.startsWith(" ") ? rest.slice(1) : rest);
        this.advance();
      } else if (line.trim() === "") {
        break;
      } else if (this.opts.kramdown && isKramdownAttrLine(line)) {
        // Kramdown block attribute marker — stop the block quote;
        // the attrs apply to the quote itself.
        break;
      } else {
        inner.push(line);
        this.advance();
      }
    }
    const innerDoc = cb(inner.join("\n"), this.opts, this.fileName, this.hooks);
    const attrs = this.tryTrailingAttrs();
    return {
      type: "block_quote",
      children: innerDoc.children,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // Lists
  // -----------------------------------------------------------------------

  private parseList(cb: MdToAstWithHook): pepatype.Block {
    const startLine = this.pos;
    const first = this.current()!;
    const ordered = /[0-9]/.test(first.trimStart()[0] as string);

    const items: pepatype.ListItem[] = [];

    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (line.trim() === "") {
        let peek = this.pos + 1;
        while (peek < this.lines.length && (this.lines[peek] as string).trim() === "") {
          peek += 1;
        }
        if (peek < this.lines.length && isListMarker(this.lines[peek] as string)) {
          this.pos = peek;
          continue;
        } else {
          break;
        }
      }

      if (isListMarker(line)) {
        const itemStart = this.pos;
        const [content, consumed] = collectListItem(this.lines, this.pos);
        this.pos += consumed;
        const itemEnd = this.pos;

        // GFM task list detection.  The `[ ]`/`[x]` marker is part
        // of the collected content, so strip it when present —
        // otherwise it would render as literal text alongside the
        // generated `<input type="checkbox">`.
        let task: pepatype.TaskState | undefined;
        if (this.opts.gfm) {
          const marker = parseTaskMarker(line);
          if (marker !== undefined) {
            task = marker[0];
          }
        }
        const itemContent = task !== undefined ? stripTaskMarker(content) : content;

        const inner = cb(itemContent, this.opts, this.fileName, this.hooks);
        items.push({
          children: inner.children,
          task,
          pos: this.span(itemStart, itemEnd),
        });
      } else {
        break;
      }
    }

    const attrs = this.tryTrailingAttrs();
    return {
      type: "list",
      ordered,
      items,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }

  // -----------------------------------------------------------------------
  // HTML block
  // -----------------------------------------------------------------------

  private collectHtmlBlock(): string {
    let html = "";
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (line.trim() === "") {
        break;
      }
      html += line;
      html += "\n";
      this.advance();
    }
    if (html.endsWith("\n")) {
      html = html.slice(0, -1);
    }
    return html;
  }

  // -----------------------------------------------------------------------
  // Paragraph
  // -----------------------------------------------------------------------

  private parseParagraph(): pepatype.Block {
    const startLine = this.pos;
    const textLines: string[] = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as string;
      if (line.trim() === "") {
        break;
      }
      // Stop if a new block construct begins.
      if (
        isThematicBreak(line) ||
        isHeading(line) ||
        isFence(line) ||
        line.trimStart().startsWith(">") ||
        isListMarker(line) ||
        isHtmlBlockStart(line) ||
        isLinkRefDef(line)
      ) {
        break;
      }
      // GFM table start
      if (this.opts.gfm && isTableStart(this.lines, this.pos)) {
        break;
      }
      // Kramdown block attribute marker `{:...}` on its own line
      // ends the paragraph (the attrs apply to it).
      if (this.opts.kramdown && isKramdownAttrLine(line)) {
        break;
      }
      textLines.push(line);
      this.advance();
    }

    const raw = textLines.join("\n");
    const attrs = this.tryTrailingAttrs();

    const children = parseInlineWithHooks(raw, this.opts, this.refs, this.hooks);
    return {
      type: "paragraph",
      children,
      attrs,
      pos: this.span(startLine, this.pos),
    };
  }
}

// ---------------------------------------------------------------------------
// Helper predicates
// ---------------------------------------------------------------------------

function isHeading(line: string): boolean {
  const t = line.trimStart();
  let h = 0;
  for (const c of t) {
    if (c === "#") {
      h += 1;
    } else {
      break;
    }
  }
  return h >= 1 && h <= 6 && (t.slice(h) === "" || t.slice(h).startsWith(" "));
}

function isFence(line: string): boolean {
  const t = line.trimStart();
  const c = t[0];
  if (c !== "`" && c !== "~") {
    return false;
  }
  let count = 0;
  for (const ch of t) {
    if (ch === c) {
      count += 1;
    } else {
      break;
    }
  }
  return count >= 3;
}

/** Returns `true` if the line is a Kramdown block attribute marker `{:...}`
 * or `{...}` on its own line. */
function isKramdownAttrLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("{") && t.endsWith("}");
}

/** Returns `true` if the line is a thematic break (`---`, `***`, or `___`
 * with at least three identical characters, optionally spaced). */
export function isThematicBreak(line: string): boolean {
  const t = [...line].filter((c) => !/\s/.test(c)).join("");
  if (t === "") {
    return false;
  }
  const c = t[0];
  return (c === "-" || c === "*" || c === "_") && [...t].every((ch) => ch === c) && t.length >= 3;
}

/** Returns `true` if the line starts with an HTML block: `<`, `</`, `<!`,
 * or `<` followed by an ASCII letter. */
function isHtmlBlockStart(line: string): boolean {
  const t = line.trimStart();
  if (!t.startsWith("<")) {
    return false;
  }
  const after = t.slice(1);
  return after.startsWith("/") || after.startsWith("!") || /^[A-Za-z]/.test(after);
}

/** Returns `true` if the line looks like a link reference definition:
 * `[label]: url ...`
 *
 * This is a lightweight check — it only verifies the `[...]` `:` prefix.
 * Use `parseLinkRefDefLine` for full parsing. */
export function isLinkRefDef(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("[")) {
    return false;
  }
  // Find closing `]` followed by `:`
  const afterOpen = trimmed.slice(1);
  const closeIdx = afterOpen.indexOf("]");
  if (closeIdx === -1) {
    return false;
  }
  const bracketClose = closeIdx + 1;
  const afterBracket = trimmed.slice(bracketClose + 1);
  return afterBracket.trimStart().startsWith(":");
}

/**
 * Parse a single line as a link reference definition.
 *
 * Returns a `LinkReferenceDefinition` with position information, or
 * `undefined` if the line is not a valid definition.
 *
 * @param line — the raw source line.
 * @param lineIdx — 0-based line index in the document.
 * @param lineStarts — byte offsets of each line start (from `computeLineStarts`).
 * @param input — the full source text (for offset clamping).
 */
export function parseLinkRefDefLine(
  line: string,
  lineIdx: number,
  lineStarts: readonly number[],
  input: string,
): pepatype.LinkReferenceDefinition | undefined {
  const trimmed = line.trimStart();

  // Must start with `[`
  if (!trimmed.startsWith("[")) {
    return undefined;
  }

  // Find the closing `]`
  const afterOpen = trimmed.slice(1);
  const closeIdx = afterOpen.indexOf("]");
  if (closeIdx === -1) {
    return undefined;
  }
  const bracketClose = 1 + closeIdx; // index in trimmed

  // Must be followed by `:`
  const afterBracket = trimmed.slice(bracketClose + 1);
  if (!afterBracket.trimStart().startsWith(":")) {
    return undefined;
  }

  // Parse the label
  const labelRaw = trimmed.slice(1, bracketClose);
  if (labelRaw.trim() === "") {
    return undefined;
  }
  const label = normalizeLabel(labelRaw);

  // Everything after `:`
  const afterColon = afterBracket.trimStart().slice(1); // skip ':'
  const rest = afterColon.trimStart();

  // Parse URL — may be wrapped in `<...>` or bare
  const [url, afterUrl] = parseLinkUrl(rest);

  // Parse optional title
  const titlePart = afterUrl.trim();
  const [title] = parseLinkTitle(titlePart);

  // Compute position
  const startOffset = Math.min(lineStarts[lineIdx] ?? 0, input.length);
  const endOffset = Math.min(startOffset + utf8ByteLength(line), input.length);
  const pos = mkSpan(
    { line: lineIdx, column: 0, offset: startOffset },
    { line: lineIdx, column: [...line].length, offset: endOffset },
  );

  return { label, url, title, pos };
}

/** Returns `true` if the line is a list marker: `-`, `*`, `+` followed by
 * a space, or 1–9 digits followed by `.` or `)` and a space. */
export function isListMarker(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("- ") || t.startsWith("* ") || t.startsWith("+ ")) {
    return true;
  }
  let digitsEnd = 0;
  for (const c of t) {
    if (/[0-9]/.test(c)) {
      digitsEnd += 1;
    } else {
      break;
    }
  }
  if (digitsEnd > 0 && digitsEnd < 10) {
    const rest = t.slice(digitsEnd);
    if (rest.startsWith(". ") || rest.startsWith(") ") || rest === "." || rest === ")") {
      return true;
    }
  }
  return false;
}

/** Collect a single list item starting at `start`. */
function collectListItem(lines: readonly string[], start: number): [string, number] {
  const first = lines[start] as string;
  const t = first.trimStart();

  let idx = first.length - t.length;
  if (t[0] === "-" || t[0] === "*" || t[0] === "+") {
    idx += 1;
  } else {
    let dlen = 0;
    for (const c of t) {
      if (/[0-9]/.test(c)) {
        dlen += 1;
      } else {
        break;
      }
    }
    idx += dlen + 1;
  }
  const markerEnd = idx;

  const contentStart = first.length - first.slice(markerEnd).trimStart().length;
  const firstContent = first.slice(contentStart);

  let content = "";
  if (firstContent === "") {
    content += "\n";
  } else {
    content += firstContent;
    content += "\n";
  }

  let consumed = 1;
  const indent = contentStart - (first.length - t.length);

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      content += "\n";
      consumed += 1;
      continue;
    }
    let leading = 0;
    for (const c of line) {
      if (c === " ") {
        leading += 1;
      } else {
        break;
      }
    }
    if (leading >= indent) {
      content += line.slice(Math.min(indent, line.length));
      content += "\n";
      consumed += 1;
    } else if (
      isListMarker(line) ||
      isHeading(line) ||
      isFence(line) ||
      isThematicBreak(line) ||
      line.trimStart().startsWith(">") ||
      isKramdownAttrLine(line)
    ) {
      break;
    } else {
      content += line;
      content += "\n";
      consumed += 1;
    }
  }

  if (content.endsWith("\n")) {
    content = content.slice(0, -1);
  }
  return [content, consumed];
}

/**
 * Parse a GFM task list marker: `[ ]`, `[x]`, `[X]`.
 * Returns `[TaskState, contentStartOffset]`.
 *
 * The offset counts from the start of the (trimmed) line and points just
 * past the closing `]` of the marker.
 */
export function parseTaskMarker(line: string): [pepatype.TaskState, number] | undefined {
  const t = line.trimStart();
  // Must be after a list marker like `- `, `* `, `+ `, `1. `
  let markerEnd: number;
  if (t[0] === "-" || t[0] === "*" || t[0] === "+") {
    markerEnd = 1;
  } else {
    let dlen = 0;
    for (const c of t) {
      if (/[0-9]/.test(c)) {
        dlen += 1;
      } else {
        break;
      }
    }
    if (dlen === 0) {
      return undefined;
    }
    markerEnd = dlen + 1; // digits + '.' or ')'
  }

  const afterMarker = t.slice(markerEnd);
  const afterMarkerTrimmed = afterMarker.trimStart();
  const trimLen = afterMarker.length - afterMarkerTrimmed.length;

  if (afterMarkerTrimmed.startsWith("[ ]")) {
    return ["unchecked", markerEnd + trimLen + 3];
  }
  if (afterMarkerTrimmed.startsWith("[x]") || afterMarkerTrimmed.startsWith("[X]")) {
    return ["checked", markerEnd + trimLen + 3];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Link reference definition helpers
// ---------------------------------------------------------------------------

/**
 * Strip a leading GFM task-list marker (`[ ]`, `[x]`, or `[X]`, plus one
 * optional following space) from list-item content collected by
 * `collectListItem`.
 *
 * Returns the content unchanged when it does not start with a marker.
 */
function stripTaskMarker(content: string): string {
  for (const marker of ["[ ]", "[x]", "[X]"]) {
    if (content.startsWith(marker)) {
      const rest = content.slice(marker.length);
      return rest.startsWith(" ") ? rest.slice(1) : rest;
    }
  }
  return content;
}

/**
 * Normalise a link label per CommonMark: trim, collapse internal whitespace
 * to single spaces, lowercase.
 */
export function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  let result = "";
  let prevWs = false;
  for (const c of trimmed) {
    if (/\s/.test(c)) {
      if (!prevWs) {
        result += " ";
        prevWs = true;
      }
    } else {
      // ASCII-only lowercase, mirroring Rust's `to_ascii_lowercase`.
      result += c.replace(/[A-Z]/g, (m) => m.toLowerCase());
      prevWs = false;
    }
  }
  return result;
}

/**
 * Parse the URL portion of a link reference definition.
 * Returns `[url, remainingText]`.
 * The URL may be wrapped in `<...>` or be bare (up to the first whitespace).
 */
export function parseLinkUrl(rest: string): [string, string] {
  rest = rest.trimStart();
  if (rest.startsWith("<")) {
    const close = rest.indexOf(">");
    if (close !== -1) {
      return [rest.slice(1, close), rest.slice(close + 1)];
    }
  }
  // Bare URL: read until whitespace
  const chars = [...rest];
  let end = chars.length;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i] as string)) {
      end = i;
      break;
    }
  }
  return [chars.slice(0, end).join(""), chars.slice(end).join("")];
}

/**
 * Parse an optional link title: `"..."`, `'...'`, or `(...)`.
 * Returns `[title | undefined, consumedLen]`.
 */
export function parseLinkTitle(rest: string): [string | undefined, number] {
  rest = rest.trimStart();
  if (rest === "") {
    return [undefined, 0];
  }
  const open = rest[0];
  if (open !== '"' && open !== "'" && open !== "(") {
    return [undefined, 0];
  }
  const close = open === '"' ? '"' : open === "'" ? "'" : ")";
  // Find the closing delimiter
  const chars = [...rest];
  let i = 1;
  while (i < chars.length) {
    if (chars[i] === close) {
      return [chars.slice(1, i).join(""), i + 1];
    }
    if (chars[i] === "\\" && i + 1 < chars.length) {
      i += 2;
      continue;
    }
    i += 1;
  }
  return [undefined, 0];
}

/**
 * Extract the comment content from `<!-- ... -->`, stripping the markers
 * and any leading/trailing whitespace.
 */
function extractCommentContent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<!--")) {
    const inner = trimmed.slice(4);
    if (inner.endsWith("-->")) {
      return inner.slice(0, -3).trim();
    }
    // No closing --> — return everything after <!--
    return inner.trim();
  }
  return trimmed;
}
