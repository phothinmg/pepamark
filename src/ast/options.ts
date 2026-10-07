import type { pepatype } from "../type/index.js";

/** The default options: both GFM and Kramdown extensions enabled. */
export const DEFAULT_AST_OPTIONS: pepatype.AstOptions = {
  gfm: true,
  kramdown: true,
  fileName: null,
};

/** Fill in missing option fields with the defaults. */
export function resolveAstOptions(options?: Partial<pepatype.AstOptions>): pepatype.AstOptions {
  return {
    gfm: options?.gfm ?? DEFAULT_AST_OPTIONS.gfm,
    kramdown: options?.kramdown ?? DEFAULT_AST_OPTIONS.kramdown,
    fileName: options?.fileName ?? DEFAULT_AST_OPTIONS.fileName,
  };
}
