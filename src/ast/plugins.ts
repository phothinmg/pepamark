import type { pepatype } from "../type/index.js";

export class AstPluginRegister implements pepatype.AstVisitor {
  constructor(private readonly inner: pepatype.AstPlugin) {}
  visitBlock(block: pepatype.Block): pepatype.VisitControl {
    return this.inner.visitBlock?.(block) ?? {};
  }

  visitInline(inline: pepatype.Inline): pepatype.InlineVisitControl {
    return this.inner.visitInline?.(inline) ?? {};
  }
}

export class ParserPluginRegister implements pepatype.AstParser {
  constructor(private readonly inner: pepatype.ParserPlugin) {}

  tryParseBlock(ctx: pepatype.BlockParseContext): pepatype.BlockParseResult | undefined {
    const result = this.inner.parseBlock?.(ctx);
    if (result === undefined) {
      return undefined;
    }
    return [result.block, Math.max(1, result.consumed ?? 1)];
  }

  tryParseInline(ctx: pepatype.InlineParseContext): pepatype.InlineParseResult | undefined {
    const result = this.inner.parseInline?.(ctx);
    if (result === undefined) {
      return undefined;
    }
    return [result.inline, result.consumed ?? 0];
  }
}
