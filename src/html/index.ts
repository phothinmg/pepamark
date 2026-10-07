import type { pepatype } from "../type/index.js";

function toHtmlAttrString(attrs: pepatype.Attributes): string {
  const parts: string[] = [];
  if (attrs.id !== undefined) {
    parts.push(`id="${escapeAttr(attrs.id)}"`);
  }
  if (attrs.classes !== undefined) {
    parts.push(`class="${escapeAttr(attrs.classes.join(" "))}"`);
  }
  if (attrs.attributes !== undefined) {
    for (const [k, v] of attrs.attributes) {
      parts.push(`${escapeAttr(k)}="${escapeAttr(v)}"`);
    }
  }
  return parts.join(" ");
}

function escapeAttr(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options that control how the AST is rendered to HTML. */
export interface RenderOptions {
  /**
   * If `true`, emit only the body content (no `<!DOCTYPE>`, `<html>`,
   * `<head>`, or `<body>` wrapper).  If `false`, emit a full HTML
   * document.  Default: `false` (full document).
   */
  fragment?: boolean | undefined;
  /**
   * Include a `<meta charset="utf-8">` in the head (only relevant when
   * `fragment` is `false`).  Defaults to `true` when `fragment` is
   * `false`.
   */
  charset?: boolean | undefined;
  /**
   * Include a `<meta name="viewport" content="width=device-width,
   * initial-scale=1.0">` in the head (only relevant when `fragment` is
   * `false`).  Defaults to `true` when `fragment` is `false`.
   */
  viewport?: boolean | undefined;
  /**
   * Optional `<title>` for the HTML head (only relevant when `fragment`
   * is `false`).  Default: `null`.
   */
  title?: string | undefined | null;
  /**
   * Optional additional CSS classes to add to `<body>` (only relevant
   * when `fragment` is `false`).  Default: `null`.
   */
  bodyClass?: string | undefined | null;
  /**
   * Optional inline CSS to inject in a `<style>` tag in the head.
   * Default: `null`.
   */
  style?: string | undefined | null;
}

/** `RenderOptions` with every field resolved to a concrete value. */
export interface ResolvedRenderOptions {
  fragment: boolean;
  charset: boolean;
  viewport: boolean;
  title: string | null;
  bodyClass: string | null;
  style: string | null;
}

/**
 * Default render options.  Note that `charset` / `viewport` only take
 * effect in full-document mode (`fragment: false`), where they default
 * to `true`.
 */
export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  fragment: false,
  charset: true,
  viewport: true,
  title: null,
  bodyClass: null,
  style: null,
};

/**
 * Apply defaults to (possibly partial) render options.
 *
 * `charset` / `viewport` only matter for full documents (`fragment ===
 * false`); they default to `true` in that mode.
 */
function resolveRenderOptions(options?: RenderOptions): ResolvedRenderOptions {
  const fragment = options?.fragment ?? DEFAULT_RENDER_OPTIONS.fragment ?? false;
  // Full-document mode: `charset` / `viewport` default to `true` here.
  const fullDocument = fragment === false;
  return {
    fragment,
    charset: options?.charset ?? fullDocument,
    viewport: options?.viewport ?? fullDocument,
    title: options?.title ?? DEFAULT_RENDER_OPTIONS.title ?? null,
    bodyClass: options?.bodyClass ?? DEFAULT_RENDER_OPTIONS.bodyClass ?? null,
    style: options?.style ?? DEFAULT_RENDER_OPTIONS.style ?? null,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Renders a Markdown AST (`Document`) to an HTML string. */
export class AstToHtml {
  private out: string;
  /** When `true`, inline text is HTML-escaped. */
  private escape: boolean;
  private opts: ResolvedRenderOptions;

  /**
   * Create a new renderer with the given options.
   *
   * Omit `opts` to use the defaults (see `DEFAULT_RENDER_OPTIONS`).
   */
  constructor(opts?: RenderOptions) {
    this.out = "";
    this.escape = true;
    this.opts = resolveRenderOptions(opts);
  }

  /** Return the HTML accumulated so far. */
  finish(): string {
    return this.out;
  }

  /**
   * Render a `Document` and return the HTML string immediately.
   *
   * Convenience wrapper around `renderDocument` + `finish`.
   */
  renderDocumentOwned(doc: pepatype.Document): string {
    this.renderDocument(doc);
    return this.finish();
  }

  // -----------------------------------------------------------------------
  // Top-level entry
  // -----------------------------------------------------------------------

  /**
   * Render a full `Document` into the internal buffer.
   *
   * When `opts.fragment` is `true` only the body content is emitted.
   * When `false`, a complete `<!DOCTYPE html>` document with `<html>`,
   * `<head>`, and `<body>` wrappers is produced.
   */
  renderDocument(doc: pepatype.Document): void {
    if (this.opts.fragment) {
      for (const b of doc.children) {
        this.renderBlock(b);
      }
    } else {
      this.out += "<!DOCTYPE html>\n<html>\n<head>\n";
      if (this.opts.charset) {
        this.out += '<meta charset="utf-8">\n';
      }
      if (this.opts.viewport) {
        this.out += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
      }
      if (this.opts.title !== null) {
        this.out += "<title>";
        this.out += this.esc(this.opts.title);
        this.out += "</title>\n";
      }
      if (this.opts.style !== null) {
        this.out += "<style>\n";
        this.out += this.opts.style;
        this.out += "\n</style>\n";
      }
      this.out += "</head>\n<body";
      if (this.opts.bodyClass !== null) {
        this.out += ' class="';
        this.out += this.escNoQuote(this.opts.bodyClass);
        this.out += '"';
      }
      this.out += ">\n";
      for (const b of doc.children) {
        this.renderBlock(b);
      }
      this.out += "</body>\n</html>\n";
    }
  }

  // -----------------------------------------------------------------------
  // Blocks
  // -----------------------------------------------------------------------

  /** Render a single block-level node. */
  renderBlock(block: pepatype.Block): void {
    switch (block.type) {
      case "heading": {
        this.out += `<h${block.level}`;
        this.emitAttrs(block.attrs);
        this.out += ">";
        for (const inline of block.children) {
          this.renderInline(inline);
        }
        this.out += `</h${block.level}>\n`;
        break;
      }
      case "paragraph": {
        this.out += "<p";
        this.emitAttrs(block.attrs);
        this.out += ">";
        for (const inline of block.children) {
          this.renderInline(inline);
        }
        this.out += "</p>\n";
        break;
      }
      case "code_block": {
        this.out += "<pre><code";
        if (block.lang !== undefined && block.lang !== "") {
          this.out += ' class="language-';
          this.out += this.escNoQuote(block.lang);
          this.out += '"';
        }
        this.emitAttrs(block.attrs);
        this.out += ">";
        // Escape `<`, `>`, `&` (etc.) so the code content is valid HTML.
        this.out += this.esc(block.code);
        this.out += "</code></pre>\n";
        break;
      }
      case "block_quote": {
        this.out += "<blockquote";
        this.emitAttrs(block.attrs);
        this.out += ">\n";
        for (const b of block.children) {
          this.renderBlock(b);
        }
        this.out += "</blockquote>\n";
        break;
      }
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        this.out += "<";
        this.out += tag;
        this.emitAttrs(block.attrs);
        this.out += ">\n";
        for (const item of block.items) {
          this.renderListItem(item);
        }
        this.out += `</${tag}>\n`;
        break;
      }
      case "thematic_break": {
        this.out += "<hr>\n";
        break;
      }
      case "html_block": {
        this.out += block.html;
        if (!block.html.endsWith("\n")) {
          this.out += "\n";
        }
        break;
      }
      case "table": {
        this.renderTable(block.table, block.attrs);
        break;
      }
      case "link_reference_definition": {
        // Not rendered as visible HTML.
        break;
      }
      case "comment": {
        this.out += "<!-- ";
        this.out += block.value;
        this.out += " -->\n";
        break;
      }
    }
  }

  /** Render a single list item (`<li>`). */
  private renderListItem(item: pepatype.ListItem): void {
    this.out += "<li";
    if (item.task !== undefined) {
      const checked = item.task === "checked";
      this.out += ' class="task-list-item"';
      if (checked) {
        this.out += ' data-checked="true"';
      }
    }
    this.out += ">";
    if (item.task !== undefined) {
      const checked = item.task === "checked";
      this.out += '<input type="checkbox" class="task-list-item-checkbox"';
      if (checked) {
        this.out += " checked";
      }
      this.out += " disabled> ";
    }
    // Render nested blocks.  If the item contains a single paragraph we
    // render it inline (no wrapping <p>) per CommonMark rendering
    // convention for tight lists.
    const first = item.children[0];
    const tight = item.children.length === 1 && first?.type === "paragraph";
    if (tight) {
      if (first !== undefined && first.type === "paragraph") {
        for (const inline of first.children) {
          this.renderInline(inline);
        }
      }
    } else {
      this.out += "\n";
      for (const b of item.children) {
        this.renderBlock(b);
      }
    }
    this.out += "</li>\n";
  }

  /** Render a GFM table. */
  private renderTable(table: pepatype.Table, attrs: pepatype.Attributes | undefined): void {
    this.out += "<table";
    this.emitAttrs(attrs);
    this.out += ">\n<thead>\n<tr>\n";
    // Header
    for (const [i, cell] of table.header.cells.entries()) {
      this.out += "<th";
      this.emitAlign(table.alignments[i]);
      this.out += ">";
      for (const inline of cell.children) {
        this.renderInline(inline);
      }
      this.out += "</th>\n";
    }
    this.out += "</tr>\n</thead>\n<tbody>\n";
    // Body rows
    for (const row of table.rows) {
      this.out += "<tr>\n";
      for (const [i, cell] of row.cells.entries()) {
        this.out += "<td";
        this.emitAlign(table.alignments[i]);
        this.out += ">";
        for (const inline of cell.children) {
          this.renderInline(inline);
        }
        this.out += "</td>\n";
      }
      this.out += "</tr>\n";
    }
    this.out += "</tbody>\n</table>\n";
  }

  /** Emit a `style="text-align: …"` attribute for a table column alignment. */
  private emitAlign(align: pepatype.TableCellAlignment | undefined): void {
    if (align === undefined) {
      return;
    }
    let css: string;
    switch (align) {
      case "default":
      case "left":
        return;
      case "center":
        css = "text-align: center";
        break;
      case "right":
        css = "text-align: right";
        break;
    }
    this.out += ' style="';
    this.out += css;
    this.out += '"';
  }

  // -----------------------------------------------------------------------
  // Inlines
  // -----------------------------------------------------------------------

  /** Render a single inline-level node. */
  renderInline(inline: pepatype.Inline): void {
    switch (inline.type) {
      case "text": {
        this.out += this.esc(inline.value);
        break;
      }
      case "emphasis": {
        const [open, close] =
          inline.level === "italic" ? ["<em>", "</em>"] : ["<strong>", "</strong>"];
        this.out += open;
        for (const child of inline.children) {
          this.renderInline(child);
        }
        this.out += close;
        break;
      }
      case "code": {
        this.out += "<code>";
        this.out += this.esc(inline.code);
        this.out += "</code>";
        break;
      }
      case "html_inline": {
        // Raw HTML — emit as-is.
        this.out += inline.html;
        break;
      }
      case "strikethrough": {
        this.out += "<del>";
        for (const child of inline.children) {
          this.renderInline(child);
        }
        this.out += "</del>";
        break;
      }
      case "hard_break": {
        this.out += "<br>\n";
        break;
      }
      case "soft_break": {
        this.out += "\n";
        break;
      }
      case "image": {
        this.out += '<img src="';
        this.out += this.escAttr(inline.url);
        this.out += '" alt="';
        this.out += this.esc(inline.alt);
        this.out += '"';
        if (inline.title != null) {
          this.out += ' title="';
          this.out += this.esc(inline.title);
          this.out += '"';
        }
        this.out += ">";
        break;
      }
      case "link":
      case "link_reference": {
        this.out += '<a href="';
        this.out += this.escAttr(inline.url);
        this.out += '"';
        if (inline.title != null) {
          this.out += ' title="';
          this.out += this.esc(inline.title);
          this.out += '"';
        }
        this.out += ">";
        for (const child of inline.text) {
          this.renderInline(child);
        }
        this.out += "</a>";
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Small helpers
  // -----------------------------------------------------------------------

  /**
   * Emit Kramdown attributes as an HTML attribute string (with a leading
   * space if non-empty).
   */
  private emitAttrs(attrs: pepatype.Attributes | undefined): void {
    if (attrs === undefined) {
      return;
    }
    const s = toHtmlAttrString(attrs);
    if (s !== "") {
      this.out += " ";
      this.out += s;
    }
  }

  /**
   * Escape text for HTML content (escapes `&`, `<`, `>`, `"`, `'`).
   * Honors the `escape` flag.
   */
  private esc(text: string): string {
    if (!this.escape) {
      return text;
    }
    return text.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  /**
   * Escape text for use inside an HTML attribute value (escapes `&`, `"`,
   * `<`, `>`).
   */
  private escAttr(text: string): string {
    return text.replace(/[&"<>]/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case '"':
          return "&quot;";
        case "<":
          return "&lt;";
        default:
          return "&gt;";
      }
    });
  }

  /**
   * Escape text without escaping single quotes — used for class names and
   * other attribute values that won't contain `'` (same escapes as
   * `escAttr`).
   */
  private escNoQuote(text: string): string {
    return this.escAttr(text);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render a parsed `Document` to an HTML string.
 *
 * `opts` may be omitted (defaults), a `RenderOptions` object, or a bare
 * `boolean` — shorthand for `{ fragment: bool }` (mirrors the Rust
 * `From<bool> for RenderOptions` impl).
 */
export function renderDocumentHtml(doc: pepatype.Document, opts?: RenderOptions | boolean): string {
  const options: RenderOptions | undefined = typeof opts === "boolean" ? { fragment: opts } : opts;
  const r = new AstToHtml(options);
  r.renderDocument(doc);
  return r.finish();
}
