import type { pepatype } from "./type/index.js";
import { type RenderOptions, renderDocumentHtml, DEFAULT_RENDER_OPTIONS } from "./html/index.js";
import { PepaMarkAst, DEFAULT_AST_OPTIONS } from "./ast/index.js";

/**
 * Options for the `Pepamark` facade: the Markdown parser options
 * (`pepatype.AstOptions`) combined with the HTML render options
 * (`RenderOptions`). Unspecified fields fall back to `DEFAULT_AST_OPTIONS`
 * / `DEFAULT_RENDER_OPTIONS`.
 */
export type PepamarkOptions = pepatype.AstOptions & RenderOptions;

/**
 * Fill in missing `PepamarkOptions` fields with the defaults.
 *
 * @param opts Partial (or omitted) options.
 * @returns Options with every field resolved to a concrete value.
 */
function resolvePepamarkOptions(opts?: PepamarkOptions): PepamarkOptions {
  const opt: PepamarkOptions = {
    ...DEFAULT_AST_OPTIONS,
    ...DEFAULT_RENDER_OPTIONS,
  };
  return {
    gfm: opts?.gfm ?? opt.gfm,
    kramdown: opts?.kramdown ?? opt.kramdown,
    fileName: opts?.fileName ?? opt.fileName,
    fragment: opts?.fragment ?? opt.fragment,
    charset: opts?.charset ?? opt.charset,
    viewport: opts?.viewport ?? opt.viewport,
    title: opts?.title ?? opt.title,
    bodyClass: opts?.bodyClass ?? opt.bodyClass,
    style: opts?.style ?? opt.style,
  } as PepamarkOptions;
}

/**
 * Pepamark — the high-level facade over the parser and the HTML renderer.
 *
 * Holds a single parsed document and lets you attach (or remove) plugins,
 * then read the AST, the front matter, and the rendered HTML. Plugin results
 * are re-applied on every property access (see {@link Pepamark.use}), so
 * getters always reflect the current plugin set.
 *
 * @typeParam F The expected shape of the parsed YAML front matter
 * (`Record<string, any>` by default).
 */
export class Pepamark<F extends Record<string, any> = {}> {
  private _opts: PepamarkOptions;
  private _astOpts: pepatype.AstOptions;
  private _htmlOpts: RenderOptions;
  private _parser: PepaMarkAst<F>;
  /**
   * Create a new Pepamark instance.
   *
   * @param rawMd The raw Markdown source text (may include a YAML front
   * matter block delimited by `---`).
   * @param options Partial options; missing fields fall back to the parser
   * and renderer defaults.
   */
  constructor(rawMd: string, options?: PepamarkOptions) {
    this._opts = resolvePepamarkOptions(options);
    this._astOpts = {
      gfm: this._opts.gfm,
      kramdown: this._opts.kramdown,
      fileName: this._opts.fileName,
    };
    this._htmlOpts = {
      fragment: this._opts.fragment,
      charset: this._opts.charset,
      viewport: this._opts.viewport,
      title: this._opts.title,
      bodyClass: this._opts.bodyClass,
      style: this._opts.style,
    };
    this._parser = new PepaMarkAst<F>(rawMd, this._astOpts);
  }
  /**
   * Register one plugin or an array of plugins and re-apply the plugin set.
   *
   * Plugins are identified by `name`, and AST (`visitor`) / parser plugins
   * are both supported.
   *
   * @param plugin A plugin or array of plugins to register.
   * @returns `this`, for chaining.
   */
  public use(plugin: pepatype.PepaMarkPlugin | pepatype.PepaMarkPlugin[]) {
    this._parser.use(plugin);
    this._parser.parsePlugins();
    return this;
  }
  /**
   * Unregister a plugin (matched by `name`) and re-apply the plugin set.
   *
   * Logs a warning if no registered plugin has the given name.
   *
   * @param plugin The plugin to remove (only its `name` is used).
   * @returns `this`, for chaining.
   */
  public remove(plugin: pepatype.PepaMarkPlugin) {
    this._parser.removePlugin(plugin);
    this._parser.parsePlugins();
    return this;
  }
  /** The parsed `Document`, with the current plugin set applied. */
  public get ast(): pepatype.Document {
    this._parser.parsePlugins();
    return this._parser.ast;
  }
  /**
   * The parsed YAML front matter, or `undefined` when the document has
   * none. Plugin results are applied before reading.
   */
  public get frontmatter(): F | undefined {
    this._parser.parsePlugins();
    if (this._parser.ast.frontmatter) {
      return this._parser.ast.frontmatter;
    }
  }
  /**
   * The document rendered to HTML, with the current plugin set applied
   * first. Whether a full document or just the body fragment is emitted
   * depends on the `fragment` render option.
   */
  public get html(): string {
    this._parser.parsePlugins();
    const htm = renderDocumentHtml(this._parser.ast, this._htmlOpts);
    return htm;
  }
}
