import { resolveAstOptions, DEFAULT_AST_OPTIONS } from "./options.js";
import type { pepatype } from "../type/index.js";
import { ParseHooks } from "./hooks.js";
import { parseMd } from "./parse_md.js";
import { ParserPluginRegister, AstPluginRegister } from "./plugins.js";
import { parseAstVisitor } from "./visitor.js";

/**
 * The low-level Markdown-to-AST engine: parses the source into a
 * `Document` and manages the plugin registry (AST visitors and parser
 * hooks).
 *
 * This is the class behind the `Pepamark` facade. The document is
 * parsed once in the constructor and re-parsed whenever plugins are
 * applied (see {@link PepaMarkAst.parsePlugins}); because re-parsing
 * always restarts from the raw source, parser plugins can be registered
 * and removed at any time.
 *
 * @typeParam T The expected shape of the parsed YAML front matter
 * (`Record<string, any>` by default).
 */
export class PepaMarkAst<T extends Record<string, any> = {}> {
  private _ast: pepatype.Document<T>;
  private _hooks: ParseHooks;
  private _options: pepatype.AstOptions;
  private _visitors: { name: string; visitor: pepatype.AstVisitor }[];
  private _parsers: { name: string; parser: pepatype.AstParser }[];
  private _rawMd: any;
  /**
   * Create a new AST engine for the given Markdown source.
   *
   * The source is parsed immediately; any plugins registered later are
   * applied by re-parsing the original input (see {@link parsePlugins}).
   *
   * @param rawMd The raw Markdown source text (may include a YAML front
   * matter block delimited by `---`).
   * @param options Partial parse options; missing fields fall back to
   * `DEFAULT_AST_OPTIONS` (GFM and Kramdown on, no file name).
   */
  constructor(rawMd: string, options?: Partial<pepatype.AstOptions>) {
    this._rawMd = rawMd;
    this._hooks = new ParseHooks();
    this._options = resolveAstOptions(options);
    this._ast = parseMd<T>(this._rawMd, this._options, this._options.fileName, this._hooks);
    this._visitors = [];
    this._parsers = [];
  }
  /**
   * Register one plugin or an array of plugins.
   *
   * `AstPlugin`s are collected as AST visitors; `ParserPlugin`s are
   * collected as parser hooks. Registration alone does nothing visible —
   * call {@link parsePlugins} (or read a getter) to apply them.
   *
   * @param plugin A plugin or array of plugins to register.
   */
  use(plugin: pepatype.PepaMarkPlugin | pepatype.PepaMarkPlugin[]): void {
    if (Array.isArray(plugin)) {
      for (const p of plugin) {
        if (p.type === "ast") {
          const visitor = new AstPluginRegister(p);
          this._visitors.push({ name: p.name, visitor });
        } else {
          const parser = new ParserPluginRegister(p);
          this._parsers.push({ name: p.name, parser });
        }
      }
    } else {
      if (plugin.type === "ast") {
        const visitor = new AstPluginRegister(plugin);
        this._visitors.push({ name: plugin.name, visitor });
      } else {
        const parser = new ParserPluginRegister(plugin);
        this._parsers.push({ name: plugin.name, parser });
      }
    }
  }
  /**
   * Apply the registered plugins to the document.
   *
   * The raw source is always re-parsed from scratch first (registering a
   * new parser plugin therefore invalidates any earlier parse results),
   * then every registered visitor runs over the freshly parsed AST, in
   * registration order.
   */
  parsePlugins() {
    if (this._parsers.length > 0) {
      for (const p of this._parsers) {
        this._hooks.push(p.parser);
      }
    }
    this._ast = parseMd(this._rawMd, this._options, this._options.fileName, this._hooks);
    if (this._visitors.length > 0) {
      for (const v of this._visitors) {
        parseAstVisitor(this._ast, v.visitor);
      }
    }
  }
  /**
   * Unregister a plugin, matched only by its `name` (within the plugin's
   * own kind — an `ast` plugin never removes a `parser` plugin and vice
   * versa). The plugin set is *not* re-applied automatically.
   *
   * Logs a warning when no matching plugin is registered.
   *
   * @param plugin The plugin to remove (only its `name` is used).
   */
  removePlugin(plugin: pepatype.PepaMarkPlugin) {
    let ok = false;
    if (plugin.type === "ast") {
      const found = this._visitors.find((v) => v.name === plugin.name);
      if (found) {
        this._visitors = this._visitors.filter((v) => v.name !== plugin.name);
        ok = true;
      }
    } else {
      const found = this._parsers.find((v) => v.name === plugin.name);
      if (found) {
        this._parsers = this._parsers.filter((v) => v.name !== plugin.name);
        ok = true;
      }
    }
    if (!ok) {
      console.warn(`Plugin name "${plugin.name}" that you want remove dose not exists.`);
    }
  }
  /** The parsed `Document`, with the registered plugins applied (see
   * {@link parsePlugins}). */
  public get ast(): pepatype.Document<T> {
    this.parsePlugins();
    return this._ast;
  }
  /**
   * The parsed YAML front matter, or an empty object when the document has
   * none. Plugin results are applied before reading.
   */
  public get frontmatter() {
    this.parsePlugins();
    return this._ast.frontmatter ?? {};
  }
}

export { DEFAULT_AST_OPTIONS };
