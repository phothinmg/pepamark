import { finalizeHookInline, ParseHooks } from "./hooks.js";
import type { pepatype } from "../type/index.js";
import { span as mkSpan, utf8Length } from "./span.js";
import { normalizeLabel } from "./block.js";

/** A map of normalised link reference labels to `[url, title]`. */
export type LinkRefMap = Map<string, [string, string | undefined]>;

/**
 * Parse inline markdown into a list of `Inline` nodes, with the given
 * options (controls GFM features).
 */
export function parseInline(input: string, options?: pepatype.AstOptions): pepatype.Inline[] {
  return parseInlineWithRefs(input, options, undefined);
}

/**
 * Parse inline markdown with an optional link reference map for resolving
 * reference-style links (`[text][label]`, `[label][]`, `[label]`).
 */
export function parseInlineWithRefs(
  input: string,
  options: pepatype.AstOptions | undefined,
  refs: LinkRefMap | undefined,
): pepatype.Inline[] {
  return parseInlineWithHooks(input, options, refs, undefined);
}

/**
 * Parse inline markdown with custom parser hooks (see `hooks`).
 *
 * Hooks run before the built-in inline matchers at every character
 * position; the first hook to claim a position wins.
 */
export function parseInlineWithHooks(
  input: string,
  options?: pepatype.AstOptions,
  refs?: LinkRefMap,
  hooks?: ParseHooks,
): pepatype.Inline[] {
  const opts: pepatype.AstOptions = options ?? { gfm: true, kramdown: true };
  const tokens: pepatype.Inline[] = [];
  const chars = [...input];
  const ctx = new InlineCtx(input, chars);
  let i = 0;
  let text = "";
  let textStart = 0;

  /** Flush the accumulated plain-text run into a Text node (using the
   * current `textStart`), then clear the buffer. */
  const flush = () => {
    if (text !== "") {
      const start = textStart;
      const end = start + [...text].length;
      tokens.push({
        type: "text",
        value: text,
        pos: mkSpan(ctx.position(start, chars.length), ctx.position(end, chars.length)),
      });
      text = "";
    }
  };

  while (i < chars.length) {
    const c = chars[i];

    // Custom parser hooks — tried before every built-in matcher so an
    // extension can both introduce new syntax and override built-ins.
    if (hooks !== undefined && !hooks.isEmpty()) {
      const hctx: pepatype.InlineParseContext = {
        rest: chars.slice(i).join(""),
        index: i,
      };
      const hooked = hooks.tryParseInline(hctx);
      if (hooked !== undefined) {
        const [node, consumed] = hooked;
        if (consumed > 0) {
          flush();
          const end = Math.min(i + consumed, chars.length);
          tokens.push(
            finalizeHookInline(
              node,
              mkSpan(ctx.position(i, chars.length), ctx.position(end, chars.length)),
            ),
          );
          i = end;
          textStart = i;
          continue;
        }
      }
    }

    // Inline code: `code` or ``code``
    if (c === "`") {
      let tickCount = 0;
      for (let j = i; j < chars.length && chars[j] === "`"; j++) {
        tickCount += 1;
      }
      const matched = matchInlineCode(chars, i, tickCount);
      if (matched !== undefined) {
        const [code, end] = matched;
        flush();
        tokens.push({
          type: "code",
          code,
          pos: mkSpan(ctx.position(i, chars.length), ctx.position(end, chars.length)),
        });
        i = end;
        textStart = i;
        continue;
      }
    }

    // GFM strikethrough: ~~text~~
    if (opts.gfm && c === "~" && i + 1 < chars.length && chars[i + 1] === "~") {
      const matched = matchStrikethrough(chars, i, ctx, options, hooks);
      if (matched !== undefined) {
        const [node, end] = matched;
        flush();
        tokens.push(node);
        i = end;
        textStart = i;
        continue;
      }
    }

    // Image: ![alt](url)
    if (c === "!" && i + 1 < chars.length && chars[i + 1] === "[") {
      const matched = matchImage(chars, i, ctx);
      if (matched !== undefined) {
        const [img, end] = matched;
        flush();
        tokens.push(img);
        i = end;
        textStart = i;
        continue;
      }
    }

    // Link: [text](url) or reference link [text][label], [label][], [label]
    if (c === "[") {
      // First try inline link `[text](url)`
      const link = matchLink(chars, i, ctx, options, hooks);
      if (link !== undefined) {
        flush();
        tokens.push(link[0]);
        i = link[1];
        textStart = i;
        continue;
      }
      // Then try reference link `[text][label]`, `[label][]`, `[label]`
      const ref = matchReferenceLink(chars, i, ctx, options, refs, hooks);
      if (ref !== undefined) {
        flush();
        tokens.push(ref[0]);
        i = ref[1];
        textStart = i;
        continue;
      }
    }

    // GFM autolink: bare URLs
    if (opts.gfm && (c === "h" || c === "w")) {
      const matched = matchAutolink(chars, i);
      if (matched !== undefined) {
        const [url, end] = matched;
        flush();
        tokens.push({
          type: "link",
          text: [
            {
              type: "text",
              value: url,
              pos: mkSpan(ctx.position(i, chars.length), ctx.position(end, chars.length)),
            },
          ],
          url,
          title: undefined,
          autolink: true,
          pos: mkSpan(ctx.position(i, chars.length), ctx.position(end, chars.length)),
        });
        i = end;
        textStart = i;
        continue;
      }
    }

    // Emphasis: **bold** / *italic* / __bold__ / _italic_
    if (c === "*" || c === "_") {
      const matched = matchEmphasis(chars, i, c, ctx, options, hooks);
      if (matched !== undefined) {
        const [node, end] = matched;
        flush();
        tokens.push(node);
        i = end;
        textStart = i;
        continue;
      }
    }

    // Hard break: two trailing spaces + newline, or backslash + newline
    if (c === "\n") {
      if (text.endsWith("  ")) {
        text = text.slice(0, -2);
        flush();
        tokens.push({
          type: "hard_break",
          pos: mkSpan(ctx.position(i, chars.length), ctx.position(i + 1, chars.length)),
        });
        i += 1;
        textStart = i;
        continue;
      }
      if (text.endsWith("\\")) {
        text = text.slice(0, -1);
        flush();
        tokens.push({
          type: "hard_break",
          pos: mkSpan(ctx.position(i, chars.length), ctx.position(i + 1, chars.length)),
        });
        i += 1;
        textStart = i;
        continue;
      }
      flush();
      tokens.push({
        type: "soft_break",
        pos: mkSpan(ctx.position(i, chars.length), ctx.position(i + 1, chars.length)),
      });
      i += 1;
      textStart = i;
      continue;
    }

    // Inline HTML (very naive: <tag ...> or </tag>)
    if (c === "<") {
      const end = matchInlineHtml(chars, i);
      if (end !== undefined) {
        flush();
        tokens.push({
          type: "html_inline",
          html: chars.slice(i, end).join(""),
          pos: mkSpan(ctx.position(i, chars.length), ctx.position(end, chars.length)),
        });
        i = end;
        textStart = i;
        continue;
      }
    }

    text += c;
    i += 1;
  }

  flush();
  return tokens;
}

/**
 * Internal context for mapping character indices to source `Position`s.
 *
 * Maintains precomputed line-start char indices and char-to-byte offset
 * tables so that `InlineCtx.position` runs in O(log n) time.
 */
export class InlineCtx {
  /** `lineStartsChar[l]` = code-point index at which line `l` begins. */
  private readonly lineStartsChar: number[] = [0];
  /** `charByteOffsets[i]` = UTF-8 byte offset of `chars[i]`. */
  private readonly charByteOffsets: number[] = [];

  constructor(input: string, chars: readonly string[]) {
    let byte = 0;
    for (const c of chars) {
      this.charByteOffsets.push(byte);
      if (c === "\n") {
        this.lineStartsChar.push(this.charByteOffsets.length);
      }
      byte += utf8Length(c);
    }
  }

  /** Position at the given char index. */
  position(i: number, charsLen: number): pepatype.Position {
    i = Math.min(i, charsLen);
    const idx = binarySearch(this.lineStartsChar, i);
    const line = idx;
    const lineStart = this.lineStartsChar[line] as number;
    const column = i - lineStart;
    let offset: number;
    if (i < this.charByteOffsets.length) {
      offset = this.charByteOffsets[i] as number;
    } else {
      const last = this.charByteOffsets[this.charByteOffsets.length - 1];
      offset =
        (last ?? 0) +
        (charsLen > 0 && this.charByteOffsets.length > 1
          ? (this.charByteOffsets[this.charByteOffsets.length - 1] as number) -
            (this.charByteOffsets[this.charByteOffsets.length - 2] as number)
          : 0);
    }
    return { line, column, offset };
  }
}

/** Find the index of `needle` in a sorted array, or the insertion point. */
function binarySearch(arr: number[], needle: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === needle) return mid;
    if ((arr[mid] as number) < needle) lo = mid + 1;
    else hi = mid - 1;
  }
  // Err(l) in Rust → l.saturating_sub(1) — the line containing `needle`.
  return Math.max(0, lo - 1);
}

// ---------------------------------------------------------------------------
// GFM - Inline Parsers
// ---------------------------------------------------------------------------

/**
 * Match GFM strikethrough `~~text~~`. Returns `[node, endIndex]`.
 */
function matchStrikethrough(
  chars: readonly string[],
  start: number,
  ctx: InlineCtx,
  options?: pepatype.AstOptions,
  hooks?: ParseHooks,
): [pepatype.Inline, number] | undefined {
  if (chars[start] !== "~" || start + 1 >= chars.length || chars[start + 1] !== "~") {
    return undefined;
  }

  const afterStr = chars.slice(start + 2).join("");
  const close = afterStr.indexOf("~~");
  if (close === -1) {
    return undefined;
  }
  const inner = afterStr.slice(0, close);
  const children = parseInlineWithHooks(inner, options, undefined, hooks);
  const end = start + 2 + close + 2;

  return [
    {
      type: "strikethrough",
      children,
      pos: mkSpan(ctx.position(start, chars.length), ctx.position(end, chars.length)),
    },
    end,
  ];
}

function findUrlEnd(chars: readonly string[], from: number): number {
  let i = from;
  while (i < chars.length) {
    const c = chars[i] as string;
    if (/\s/.test(c) || c === "<" || c === ">") {
      break;
    }
    // Trailing punctuation: . , ; : ! ? ) — but not if part of URL path
    if (".;:!?,".includes(c) || c === ")") {
      if (i + 1 >= chars.length || /\s/.test(chars[i + 1] as string)) {
        break;
      }
    }
    i += 1;
  }
  return i;
}

/**
 * Detect a bare URL for GFM autolink (www.example.com or https://example.com).
 * Returns `[url, endIndex]` relative to `chars`.
 */
function matchAutolink(chars: readonly string[], start: number): [string, number] | undefined {
  // Check for https:// or http://
  const protocols = ["https://", "http://"];

  for (const proto of protocols) {
    if (
      start + proto.length <= chars.length &&
      chars.slice(start, start + proto.length).join("") === proto
    ) {
      const end = findUrlEnd(chars, start + proto.length);
      return [chars.slice(start, end).join(""), end];
    }
  }

  // Check for www.
  const www = "www.";
  if (
    start + www.length <= chars.length &&
    chars.slice(start, start + www.length).join("") === www
  ) {
    const end = findUrlEnd(chars, start + www.length);
    const url = chars.slice(start, end).join("");
    // Prepend https:// for www.
    return [`https://${url}`, end];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Text accumulation is handled inline by the main `parseInlineWithHooks`
// loop (see the `flush` closure there), mirroring the Rust `flush_text`
// helper's behaviour.
// ---------------------------------------------------------------------------

function matchInlineCode(
  chars: readonly string[],
  start: number,
  tickCount: number,
): [string, number] | undefined {
  const open = "`".repeat(tickCount);
  const restStr = chars.slice(start + tickCount).join("");
  const closeIdx = restStr.indexOf(open);
  if (closeIdx === -1) {
    return undefined;
  }
  const code = restStr.slice(0, closeIdx);
  const end = start + tickCount + closeIdx + tickCount;
  return [code, end];
}

/**
 * Match a reference-style link starting at `chars[start]` (which must be `[`).
 * Supports full: `[text][label]`, collapsed: `[label][]`, and shortcut: `[label]`.
 */
function matchReferenceLink(
  chars: readonly string[],
  start: number,
  ctx: InlineCtx,
  options?: pepatype.AstOptions,
  refs?: LinkRefMap,
  hooks?: ParseHooks,
): [pepatype.Inline, number] | undefined {
  if (refs === undefined) {
    return undefined;
  }
  if (chars[start] !== "[") {
    return undefined;
  }

  // Find the closing `]` of the first bracket group, respecting nested brackets
  const first = matchBracket(chars, start, "[");
  if (first === undefined) {
    return undefined;
  }
  const [text, afterFirst] = first;

  // Check for a second `[label]` group
  let label: string;
  let end: number;
  if (afterFirst < chars.length && chars[afterFirst] === "[") {
    // Full reference: [text][label]
    const second = matchBracket(chars, afterFirst, "[");
    if (second === undefined) {
      return undefined;
    }
    const [labelText, afterLabel] = second;
    if (labelText.trim() === "") {
      // Collapsed: [text][] — use the text as the label
      label = text;
      end = afterLabel;
    } else {
      label = labelText;
      end = afterLabel;
    }
  } else {
    // Shortcut: [label]
    label = text;
    end = afterFirst;
  }

  const normalized = normalizeLabel(label);
  const ref = refs.get(normalized);
  if (ref === undefined) {
    return undefined;
  }
  const [url, title] = ref;

  const children = parseInlineWithHooks(text, options, undefined, hooks);
  return [
    {
      type: "link_reference",
      text: children,
      label: normalized,
      url,
      title,
      pos: mkSpan(ctx.position(start, chars.length), ctx.position(end, chars.length)),
    },
    end,
  ];
}

function matchLink(
  chars: readonly string[],
  start: number,
  ctx: InlineCtx,
  options?: pepatype.AstOptions,
  hooks?: ParseHooks,
): [pepatype.Inline, number] | undefined {
  const first = matchBracket(chars, start, "[");
  if (first === undefined) return undefined;
  const [text, afterText] = first;
  const paren = matchParen(chars, afterText);
  if (paren === undefined) return undefined;
  const [url, title, afterUrl] = paren;
  const children = parseInlineWithHooks(text, options, undefined, hooks);
  return [
    {
      type: "link",
      text: children,
      url,
      title,
      autolink: false,
      pos: mkSpan(ctx.position(start, chars.length), ctx.position(afterUrl, chars.length)),
    },
    afterUrl,
  ];
}

function matchImage(
  chars: readonly string[],
  start: number,
  ctx: InlineCtx,
): [pepatype.Inline, number] | undefined {
  const first = matchBracket(chars, start + 1, "[");
  if (first === undefined) return undefined;
  const [alt, afterText] = first;
  const paren = matchParen(chars, afterText);
  if (paren === undefined) return undefined;
  const [url, title, afterUrl] = paren;
  return [
    {
      type: "image",
      alt,
      url,
      title,
      pos: mkSpan(ctx.position(start, chars.length), ctx.position(afterUrl, chars.length)),
    },
    afterUrl,
  ];
}

/** Match `[...content...]` starting at `chars[start]`. */
function matchBracket(
  chars: readonly string[],
  start: number,
  open: string,
): [string, number] | undefined {
  if (chars[start] !== open) {
    return undefined;
  }
  const close = open === "[" ? "]" : ")";
  let depth = 1;
  let i = start + 1;
  let content = "";
  while (i < chars.length) {
    const c = chars[i];
    if (c === open) {
      depth += 1;
      content += c;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return [content, i + 1];
      }
      content += c;
    } else {
      content += c;
    }
    i += 1;
  }
  return undefined;
}

/** Match `(...)` starting at `chars[start]`. */
function matchParen(
  chars: readonly string[],
  start: number,
): [string, string | undefined, number] | undefined {
  if (chars[start] !== "(") {
    return undefined;
  }
  let depth = 1;
  let i = start + 1;
  let raw = "";
  while (i < chars.length) {
    const c = chars[i];
    if (c === "(") {
      depth += 1;
      raw += c;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) {
        const [url, title] = parseLinkDest(raw);
        return [url, title, i + 1];
      }
      raw += c;
    } else {
      raw += c;
    }
    i += 1;
  }
  return undefined;
}

/** Split `url  "title"` into components. */
function parseLinkDest(raw: string): [string, string | undefined] {
  const trimmed = raw.trim();
  if (trimmed.endsWith('"')) {
    const rest = trimmed.slice(0, -1);
    const qidx = rest.lastIndexOf('"');
    if (qidx !== -1) {
      return [rest.slice(0, qidx).trim(), rest.slice(qidx + 1).trim()];
    }
  }
  if (trimmed.endsWith("'")) {
    const rest = trimmed.slice(0, -1);
    const qidx = rest.lastIndexOf("'");
    if (qidx !== -1) {
      return [rest.slice(0, qidx).trim(), rest.slice(qidx + 1).trim()];
    }
  }
  return [trimmed, undefined];
}

function matchEmphasis(
  chars: readonly string[],
  start: number,
  marker: string,
  ctx: InlineCtx,
  options?: pepatype.AstOptions,
  hooks?: ParseHooks,
): [pepatype.Inline, number] | undefined {
  let run = 0;
  for (let j = start; j < chars.length && chars[j] === marker; j++) {
    run += 1;
  }
  // Try bold first (double marker)
  if (run >= 2) {
    const close = findEmphasisClose(chars, start + 2, marker, 2);
    if (close !== undefined) {
      const inner = chars.slice(start + 2, close).join("");
      const children = parseInlineWithHooks(inner, options, undefined, hooks);
      const after = close + 2;
      return [
        {
          type: "emphasis",
          level: "bold",
          children,
          pos: mkSpan(ctx.position(start, chars.length), ctx.position(after, chars.length)),
        },
        after,
      ];
    }
  }
  // Single — italic
  const end = findEmphasisClose(chars, start + 1, marker, 1);
  if (end === undefined) {
    return undefined;
  }
  const inner = chars.slice(start + 1, end).join("");
  const children = parseInlineWithHooks(inner, options, undefined, hooks);
  const after = end + 1;
  return [
    {
      type: "emphasis",
      level: "italic",
      children,
      pos: mkSpan(ctx.position(start, chars.length), ctx.position(after, chars.length)),
    },
    after,
  ];
}

function findEmphasisClose(
  chars: readonly string[],
  from: number,
  marker: string,
  count: number,
): number | undefined {
  let i = from;
  while (i < chars.length) {
    if (chars[i] === marker) {
      let run = 0;
      for (let j = i; j < chars.length && chars[j] === marker; j++) {
        run += 1;
      }
      if (run >= count) {
        return i;
      }
      i += run;
      continue;
    }
    i += 1;
  }
  return undefined;
}

function matchInlineHtml(chars: readonly string[], start: number): number | undefined {
  if (chars[start] !== "<") {
    return undefined;
  }
  let i = start + 1;
  // comment
  if (chars[i] === "!") {
    const slice = chars.slice(start);
    for (let j = 0; j + 2 < slice.length; j++) {
      if (slice[j] === "-" && slice[j + 1] === "-" && slice[j + 2] === ">") {
        return start + j + 3;
      }
    }
    return undefined;
  }
  // closing tag
  if (chars[i] === "/") {
    i += 1;
  }
  // tag name
  if (i < chars.length && /[A-Za-z]/.test(chars[i] as string)) {
    while (i < chars.length && chars[i] !== ">") {
      i += 1;
    }
    if (i < chars.length && chars[i] === ">") {
      return i + 1;
    }
  }
  return undefined;
}
