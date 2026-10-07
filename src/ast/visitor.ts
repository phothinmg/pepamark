import type { pepatype } from "../type/index.js";

export function parseAstVisitor(doc: pepatype.Document, visitor: pepatype.AstVisitor): void {
  visitBlocksVec(doc.children, visitor);
}

/**
 * Normalise a partial control object into its fully-defaulted form.
 * Mutually exclusive fields are resolved in the order: `remove` →
 * `replaceWith` → keep.  `insertBefore` and `insertAfter` apply regardless.
 */
function resolveVisitControl(ctrl: pepatype.VisitControl | undefined): {
  insertBefore: pepatype.Block[];
  insertAfter: pepatype.Block[];
  replaceWith: pepatype.Block[] | undefined;
  remove: boolean;
  recurse: boolean;
} {
  return {
    insertBefore: ctrl?.insertBefore ?? [],
    insertAfter: ctrl?.insertAfter ?? [],
    replaceWith: ctrl?.replaceWith,
    remove: ctrl?.remove ?? false,
    recurse: ctrl?.recurse ?? false,
  };
}

function resolveInlineVisitControl(ctrl: pepatype.InlineVisitControl | undefined): {
  insertBefore: pepatype.Inline[];
  insertAfter: pepatype.Inline[];
  replaceWith: pepatype.Inline[] | undefined;
  remove: boolean;
  recurse: boolean;
} {
  return {
    insertBefore: ctrl?.insertBefore ?? [],
    insertAfter: ctrl?.insertAfter ?? [],
    replaceWith: ctrl?.replaceWith,
    remove: ctrl?.remove ?? false,
    recurse: ctrl?.recurse ?? false,
  };
}

function visitBlocksVec(children: pepatype.Block[], visitor: pepatype.AstVisitor): void {
  let i = 0;
  while (i < children.length) {
    // take ownership of the node so the visitor can freely replace/remove it
    const node = children.splice(i, 1)[0] as pepatype.Block;

    const ctrl = resolveVisitControl(visitor.visitBlock?.(node));
    const { insertBefore, insertAfter, replaceWith, remove, recurse } = ctrl;

    // insertBefore: put these at the original position
    if (insertBefore.length > 0) {
      children.splice(i, 0, ...insertBefore);
      i += insertBefore.length;
    }

    // removal requested
    if (remove) {
      if (insertAfter.length > 0) {
        children.splice(i, 0, ...insertAfter);
        i += insertAfter.length;
      }
      // original removed, continue (don't increment i)
      continue;
    }

    // replacement requested
    if (replaceWith !== undefined) {
      children.splice(i, 0, ...replaceWith);
      i += replaceWith.length;
      continue;
    }

    // keep the (possibly mutated) node; recurse into children if requested
    if (recurse) {
      switch (node.type) {
        case "heading":
        case "paragraph":
          visitInlinesVec(node.children, visitor);
          break;
        case "block_quote":
          visitBlocksVec(node.children, visitor);
          break;
        case "list":
          for (const item of node.items) {
            visitBlocksVec(item.children, visitor);
          }
          break;
        case "table":
          visitTable(node.table, visitor);
          break;
        // code_block, thematic_break, html_block,
        // link_reference_definition, and comment have no nested AST children
      }
    }

    // insert the original (possibly mutated) node back into the vector
    children.splice(i, 0, node);
    i += 1;

    // insertAfter
    if (insertAfter.length > 0) {
      children.splice(i, 0, ...insertAfter);
      i += insertAfter.length;
    }
  }
}

function visitTable(table: pepatype.Table, visitor: pepatype.AstVisitor): void {
  for (const cell of table.header.cells) {
    visitInlinesVec(cell.children, visitor);
  }
  for (const row of table.rows) {
    for (const cell of row.cells) {
      visitInlinesVec(cell.children, visitor);
    }
  }
}

function visitInlinesVec(inlines: pepatype.Inline[], visitor: pepatype.AstVisitor): void {
  let i = 0;
  while (i < inlines.length) {
    const node = inlines.splice(i, 1)[0] as pepatype.Inline;
    const ctrl = resolveInlineVisitControl(visitor.visitInline?.(node));
    const { insertBefore, insertAfter, replaceWith, remove, recurse } = ctrl;

    if (insertBefore.length > 0) {
      inlines.splice(i, 0, ...insertBefore);
      i += insertBefore.length;
    }

    if (remove) {
      if (insertAfter.length > 0) {
        inlines.splice(i, 0, ...insertAfter);
        i += insertAfter.length;
      }
      continue;
    }

    if (replaceWith !== undefined) {
      inlines.splice(i, 0, ...replaceWith);
      continue;
    }

    if (recurse) {
      switch (node.type) {
        case "emphasis":
        case "strikethrough":
          visitInlinesVec(node.children, visitor);
          break;
        case "link":
        case "link_reference":
          visitInlinesVec(node.text, visitor);
          break;
        // text, code, image, html_inline, hard_break, soft_break have no
        // nested inlines
      }
    }

    inlines.splice(i, 0, node);
    i += 1;

    if (insertAfter.length > 0) {
      inlines.splice(i, 0, ...insertAfter);
      i += insertAfter.length;
    }
  }
}
