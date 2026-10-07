namespace pepatype {
  /** Parsed Kramdown block attributes (`{:#id .class key="val"}`). */
  export interface Attributes {
    /** HTML `id` attribute. */
    id?: string;
    /** CSS class list. */
    classes?: string[];
    /** Arbitrary key/value attributes. */
    attributes?: [string, string][];
  }
  /** A zero-based point in the source text. */
  export interface Position {
    /** Line number, 0-based. */
    line: number;
    /** Column number, 0-based (in characters / code points). */
    column: number;
    /** Byte offset from the start of the input (UTF-8). */
    offset: number;
  }

  /** A half-open span `[start, end)` covering a node's source text. */
  export interface Span {
    /** The start position (inclusive). */
    start: Position;
    /** The end position (exclusive). */
    end: Position;
  }
  // ---------------------------------------------------------------------------
  // Block-level nodes
  // ---------------------------------------------------------------------------

  /** Block-level nodes. */
  export type Block =
    | Heading
    | Paragraph
    | CodeBlock
    | BlockQuote
    | List
    | ThematicBreak
    | HtmlBlock
    | TableBlock
    | LinkReferenceDefinitionBlock
    | Comment;

  /** `# Heading` through `###### Heading`. */
  export interface Heading {
    type: "heading";
    /** Heading level (1–6). */
    level: number;
    /** Inline content of the heading. */
    children: Inline[];
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** Plain paragraph text. */
  export interface Paragraph {
    type: "paragraph";
    /** Inline content of the paragraph. */
    children: Inline[];
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** Fenced or indented code block. */
  export interface CodeBlock {
    type: "code_block";
    /** Language hint from the info string (e.g. `rust` from ` ```rust `). */
    lang?: string | undefined;
    /** The raw code content. */
    code: string;
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** A block quote (`> ...`). Children are re-parsed as a sub-document. */
  export interface BlockQuote {
    type: "block_quote";
    /** Nested block content inside the quote. */
    children: Block[];
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** An ordered (`1.`) or unordered (`-`, `*`, `+`) list. */
  export interface List {
    type: "list";
    /** `true` for ordered lists, `false` for unordered. */
    ordered: boolean;
    /** The list items. */
    items: ListItem[];
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** A thematic break (`---`, `***`, or `___` on a line by itself). */
  export interface ThematicBreak {
    type: "thematic_break";
    /** Source span. */
    pos: Span;
  }

  /** A raw HTML block. */
  export interface HtmlBlock {
    type: "html_block";
    /** The raw HTML content. */
    html: string;
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /** A GFM table (variant named `TableBlock` to avoid clashing with `Table`). */
  export interface TableBlock {
    type: "table";
    /** The table structure (header, rows, alignments). */
    table: Table;
    /** Source span. */
    pos: Span;
    /** Optional Kramdown attributes. */
    attrs?: Attributes | undefined;
  }

  /**
   * A Markdown link reference definition: `[label]: url "title"`.
   * (Variant named `LinkReferenceDefinitionBlock` to avoid clashing with the
   * document-level `LinkReferenceDefinition` type.)
   */
  export interface LinkReferenceDefinitionBlock {
    type: "link_reference_definition";
    /** Normalised label (lowercased, trimmed). */
    label: string;
    /** The destination URL. */
    url: string;
    /** Optional link title. */
    title?: string | undefined;
    /** Source span. */
    pos: Span;
  }

  /** An HTML comment block (`<!-- ... -->`). */
  export interface Comment {
    type: "comment";
    /** The comment text (markers stripped). */
    value: string;
    /** Source span. */
    pos: Span;
  }

  // ---------------------------------------------------------------------------
  // Link Reference Definitions
  // ---------------------------------------------------------------------------

  /** A link reference definition collected at the document level. */
  export interface LinkReferenceDefinition {
    /** Normalised label (lowercased, trimmed). */
    label: string;
    /** The destination URL. */
    url: string;
    /** Optional link title. */
    title?: string | undefined;
    /** Source span. */
    pos: Span;
  }

  // ---------------------------------------------------------------------------
  // Lists
  // ---------------------------------------------------------------------------

  /** A single list item (an `<li>`). Contains nested block content. */
  export interface ListItem {
    /** Nested block content of the item. */
    children: Block[];
    /** GFM task-list state: `undefined` = not a task. */
    task?: TaskState | undefined;
    /** Span of the item in the *sub-document* of its enclosing list. */
    pos: Span;
  }

  /** GFM task-list checkbox state. */
  export type TaskState = "unchecked" | "checked";
  /** `[ ]` — unchecked */

  // ---------------------------------------------------------------------------
  // Tablessss
  // ---------------------------------------------------------------------------

  /** A GFM table. */
  export interface Table {
    /** The header row. */
    header: TableRow;
    /** Body rows. */
    rows: TableRow[];
    /** Column alignment specifications (one per column). */
    alignments: TableCellAlignment[];
  }

  /** A single table row (header or body). */
  export interface TableRow {
    /** The cells in this row. */
    cells: TableCell[];
  }

  /** A single table cell. */
  export interface TableCell {
    /** Inline content of the cell. */
    children: Inline[];
  }

  /** Column alignment for table cells. */
  export type TableCellAlignment = "default" | "left" | "center" | "right";

  // ---------------------------------------------------------------------------
  // Inline-level nodes
  // ---------------------------------------------------------------------------

  /** Inline-level nodes. */
  export type Inline =
    | Text
    | Emphasis
    | Code
    | HtmlInline
    | Strikethrough
    | HardBreak
    | SoftBreak
    | Image
    | Link
    | LinkReference;

  /** Plain text content. */
  export interface Text {
    type: "text";
    /** The text value. */
    value: string;
    /** Source span. */
    pos: Span;
  }

  /**
   * Emphasis (`*italic*` / `**bold**` / `_italic_` / `__bold__`).
   */
  export interface Emphasis {
    type: "emphasis";
    /** Emphasis level (italic or bold). */
    level: EmphasisLevel;
    /** Nested inline content. */
    children: Inline[];
    /** Source span. */
    pos: Span;
  }

  /** Inline code (`` `code` ``). */
  export interface Code {
    type: "code";
    /** The code text. */
    code: string;
    /** Source span. */
    pos: Span;
  }

  /** Raw inline HTML (e.g. `<span>`). */
  export interface HtmlInline {
    type: "html_inline";
    /** The raw HTML string. */
    html: string;
    /** Source span. */
    pos: Span;
  }

  /** GFM strikethrough: `~~text~~`. */
  export interface Strikethrough {
    type: "strikethrough";
    /** Nested inline content. */
    children: Inline[];
    /** Source span. */
    pos: Span;
  }

  /** A hard line break (two trailing spaces or backslash before newline). */
  export interface HardBreak {
    type: "hard_break";
    /** Source span. */
    pos: Span;
  }

  /** A soft line break (ordinary newline within a paragraph). */
  export interface SoftBreak {
    type: "soft_break";
    /** Source span. */
    pos: Span;
  }

  /** An inline image: `![alt](url)`. */
  export interface Image {
    type: "image";
    /** Alternative text. */
    alt: string;
    /** Image URL. */
    url: string;
    /** Optional title. */
    title?: string | undefined;
    /** Source span. */
    pos: Span;
  }

  /** An inline link: `[text](url)`. */
  export interface Link {
    type: "link";
    /** Link text (inline children). */
    text: Inline[];
    /** Destination URL. */
    url: string;
    /** Optional title. */
    title?: string | undefined;
    /** `true` if this is a GFM autolink (bare URL). */
    autolink: boolean;
    /** Source span. */
    pos: Span;
  }

  /**
   * A reference-style link: `[text][label]`, `[label][]`, or shortcut `[label]`.
   * The `url` and `title` are resolved from the document's link reference
   * definitions during parsing.
   */
  export interface LinkReference {
    type: "link_reference";
    /** Link text (inline children). */
    text: Inline[];
    /** Normalised label used to look up the reference. */
    label: string;
    /** Resolved destination URL. */
    url: string;
    /** Optional resolved title. */
    title?: string | undefined;
    /** Source span. */
    pos: Span;
  }

  /** Emphasis strength. */
  export type EmphasisLevel = "italic" | "bold";

  /** A Markdown document — the root of the AST.
   *
   * Contains the top-level block children and all link reference definitions
   * collected from the source text.
   */
  export interface Document<T extends Record<string, any> = {}> {
    /** Always `"root"`. */
    type: "root";
    /** Optional source file name. */
    fileName?: string | undefined | null;
    /** Span of the whole document in the source text. */
    pos: Span;
    /** Top-level block children. */
    children: Block[];
    frontmatter?: T;
    /** All link reference definitions collected from the document. */
    linkReferences?: LinkReferenceDefinition[];
  }

  /** Options that control how Markdown is parsed. */
  export interface AstOptions {
    /**
     * Enable GitHub Flavored Markdown (tables, strikethrough, task lists,
     * autolinks).  Default: `true`.
     */
    gfm: boolean;
    /**
     * Enable Kramdown-style block attributes (`{:#id .class key="val"}`).
     * Default: `true`.
     */
    kramdown: boolean;
    /**
     * Optional file name to attach to the parsed `Document`.
     */
    fileName?: string | undefined | null;
  }
  // ======================== PLUGINS ==================================
  // 1. ------------- Visitors
  /** Control returned from `visitBlock` describing edits to perform. */
  export interface VisitControl {
    /** Nodes to insert before the current node's position. */
    insertBefore?: Block[];
    /** Nodes to insert after the current node's position. */
    insertAfter?: Block[];
    /** Replace the current node with these nodes (not themselves visited). */
    replaceWith?: Block[];
    /** Remove the current node entirely. */
    remove?: boolean;
    /** Whether to recurse into this node's child nodes. Default `false`. */
    recurse?: boolean;
  }
  /** Control returned from `visitInline` describing edits to perform on
   * inline nodes. Mirrors `VisitControl` but for `Inline` nodes. */
  export interface InlineVisitControl {
    /** Nodes to insert before the current node's position. */
    insertBefore?: Inline[];
    /** Nodes to insert after the current node's position. */
    insertAfter?: Inline[];
    /** Replace the current node with these nodes (not themselves visited). */
    replaceWith?: Inline[];
    /** Remove the current node entirely. */
    remove?: boolean;
    /** Whether to recurse into this node's child nodes. Default `false`. */
    recurse?: boolean;
  }
  /** Visitor interface for AST nodes. */
  export interface AstVisitor {
    /**
     * Called for every block-level node (pre-order). Return a `VisitControl`
     * to indicate modifications. The callback may also mutate the node
     * in-place.
     */
    visitBlock?(block: Block): VisitControl;

    /**
     * Called for every inline-level node (pre-order). Return an
     * `InlineVisitControl` to indicate modifications. The callback may also
     * mutate the inline node in-place.
     */
    visitInline?(inline: Inline): InlineVisitControl;
  }
  export interface AstPlugin {
    name: string;
    type: "ast";
    /** Optional callback for block nodes (JS: `visitBlock`). */
    visitBlock?(block: Block): VisitControl;
    /** Optional callback for inline nodes (JS: `visitInline`). */
    visitInline?(inline: Inline): InlineVisitControl;
  }
  // 2. --------------- Parsers
  // Parser Hooks
  export interface BlockParseContext {
    /** The current (unmodified) source line. */
    line: string;
    /** 0-based index of the current line in the (sub-)document. */
    lineIndex: number;
    /** Remaining lines starting at the current line (`lines[0]` is `line`). */
    lines: string[];
  }

  /** Context passed to inline parser hooks. */
  export interface InlineParseContext {
    /** Remaining inline text starting at the current character position. */
    rest: string;
    /** 0-based character index of the current position in the inline text. */
    index: number;
  }

  // ---------------------------------------------------------------------------
  // Hook interface
  // ---------------------------------------------------------------------------

  /** A hook-returned block result: the node plus the number of lines consumed. */
  export type BlockParseResult = [Block, number];

  /** A hook-returned inline result: the node plus the number of characters consumed. */
  export type InlineParseResult = [Inline, number];

  /**
   * Custom parser hook interface.  Implement this to parse extension syntax
   * during parsing.
   *
   * Both methods are optional — implement only the phase you need.  Return
   * `undefined` to decline and let the next hook (or the built-in parser)
   * handle the position.
   */
  export interface AstParser {
    /**
     * Try to parse a block at the current line.
     *
     * Returns the parsed `Block` and the number of source lines it consumed
     * (must be at least 1; `0` is treated as `1`), or `undefined` to decline.
     * The returned block's `pos` span is overwritten with an accurate source
     * span, and a Kramdown `{:...}` attribute block on a following line is
     * applied automatically.
     */
    tryParseBlock?(ctx: BlockParseContext): BlockParseResult | undefined;

    /**
     * Try to parse inline content starting at the current character.
     *
     * Returns the parsed `Inline` node and the number of characters it
     * consumed (must be at least 1; `0` makes the result be ignored), or
     * `undefined` to decline.  The returned node's `pos` span is overwritten
     * with an accurate source span.
     */
    tryParseInline?(ctx: InlineParseContext): InlineParseResult | undefined;
  }
  export interface ParserPlugin {
    name: string;
    type: "parser";
    /**
     * Optional block parser hook. Returns `{ block, consumed }` or
     * `undefined` to decline.
     */
    parseBlock?(ctx: BlockParseContext): { block: Block; consumed?: number } | undefined;
    /**
     * Optional inline parser hook. Returns `{ inline, consumed }` or
     * `undefined` to decline.
     */
    parseInline?(ctx: InlineParseContext): { inline: Inline; consumed?: number } | undefined;
  }
  // 3. Peisar Plugin
  export type PepaMarkPlugin = AstPlugin | ParserPlugin;
}

export type { pepatype };
