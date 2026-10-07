import type { pepatype } from "../type/index.js";

// ---------------------------------------------------------------------------
// Hook registry
// ---------------------------------------------------------------------------

/**
 * Ordered registry of `AstParser` hooks, threaded through the block and
 * inline parsers.
 *
 * Hooks are tried in registration order; the first hook to claim a position
 * wins.
 */
export class ParseHooks {
  private readonly parsers: pepatype.AstParser[] = [];

  /** An empty registry — no hooks run (the default when none registered). */
  static empty(): ParseHooks {
    return new ParseHooks();
  }

  /** Register a hook (appended after any existing hooks). */
  push(parser: pepatype.AstParser): void {
    this.parsers.push(parser);
  }

  /** Chainable `push` — returns the registry so calls can be chained:
   * `ParseHooks.empty().with(a).with(b)`. */
  with(parser: pepatype.AstParser): this {
    this.parsers.push(parser);
    return this;
  }

  /** `true` when no hooks are registered. */
  isEmpty(): boolean {
    return this.parsers.length === 0;
  }

  /** Try every registered block hook in order. */
  tryParseBlock(ctx: pepatype.BlockParseContext): pepatype.BlockParseResult | undefined {
    for (const parser of this.parsers) {
      const result = parser.tryParseBlock?.(ctx);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  /** Try every registered inline hook in order. */
  tryParseInline(ctx: pepatype.InlineParseContext): pepatype.InlineParseResult | undefined {
    for (const parser of this.parsers) {
      const result = parser.tryParseInline?.(ctx);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Node finalisation helpers
// ---------------------------------------------------------------------------

/**
 * Overwrite a hook-returned block's source span (computed from the number
 * of consumed lines) and apply a Kramdown `{:...}` attribute block if one
 * follows the block in the source.  Existing `attrs` on the node are kept
 * unless trailing attributes are found.  Variants without an `attrs` field
 * (`thematic_break`, `link_reference_definition`, `comment`) only get their
 * `pos` overwritten.
 */
export function finalizeHookBlock(
  block: pepatype.Block,
  pos: pepatype.Span,
  trailingAttrs?: pepatype.Attributes | undefined,
): pepatype.Block {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "code_block":
    case "block_quote":
    case "list":
    case "html_block":
    case "table":
      return { ...block, pos, attrs: trailingAttrs ?? block.attrs };
    case "thematic_break":
    case "link_reference_definition":
    case "comment":
      return { ...block, pos };
  }
}

/**
 * Overwrite a hook-returned inline node's source span (computed from the
 * number of consumed characters).
 */
export function finalizeHookInline(node: pepatype.Inline, pos: pepatype.Span): pepatype.Inline {
  return { ...node, pos } as pepatype.Inline;
}
