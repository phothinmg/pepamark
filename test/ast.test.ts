import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PepaMarkAst } from "../src/ast/index.js";
import type { pepatype } from "../src/type/index.js";

const emptySpan: pepatype.Span = {
  start: { line: 0, column: 0, offset: 0 },
  end: { line: 0, column: 0, offset: 0 },
};

describe("PepaMarkAst", () => {
  it("parses front matter, block nodes, inline nodes, and link references", () => {
    const ast = new PepaMarkAst<{ title: string }>(
      `---
title: Getting started
---
# Welcome

Read [the guide][guide].

[guide]: /guide "Guide"`,
      { fileName: "getting-started.md" },
    );

    assert.deepEqual(ast.frontmatter, { title: "Getting started" });
    assert.equal(ast.ast.fileName, "getting-started.md");
    assert.deepEqual(
      ast.ast.children.map((node) => node.type),
      ["heading", "paragraph", "link_reference_definition"],
    );

    const paragraph = ast.ast.children[1];
    assert.equal(paragraph?.type, "paragraph");
    assert.deepEqual(
      paragraph?.children.map((node) => node.type),
      ["text", "link_reference", "text"],
    );

    const link =
      paragraph?.type === "paragraph" ? paragraph.children[1] : undefined;
    assert.equal(link?.type, "link_reference");
    assert.equal(
      link?.type === "link_reference" ? link.url : undefined,
      "/guide",
    );
    assert.deepEqual(
      ast.ast.linkReferences?.map(({ label, url, title }) => ({
        label,
        url,
        title,
      })),
      [{ label: "guide", url: "/guide", title: "Guide" }],
    );
  });

  it("applies GFM options when parsing extension syntax", () => {
    const markdown = `Name | Value
--- | ---:
PepaMark | 1`;

    const defaultAst = new PepaMarkAst(markdown).ast;
    const withoutGfm = new PepaMarkAst(markdown, { gfm: false }).ast;

    assert.equal(defaultAst.children[0]?.type, "table");
    assert.equal(withoutGfm.children[0]?.type, "paragraph");
  });

  it("runs registered parser and visitor plugins and can remove them", () => {
    const parserPlugin: pepatype.PepaMarkPlugin = {
      name: "notice-parser",
      type: "parser",
      parseInline({ rest }) {
        if (!rest.startsWith(":notice:")) {
          return undefined;
        }

        return {
          inline: { type: "text", value: "NOTICE", pos: emptySpan },
          consumed: ":notice:".length,
        };
      },
    };
    const visitorPlugin: pepatype.PepaMarkPlugin = {
      name: "uppercase-text",
      type: "ast",
      visitBlock() {
        return { recurse: true };
      },
      visitInline(inline) {
        if (inline.type === "text") {
          inline.value = inline.value.toUpperCase();
        }
        return {};
      },
    };
    const ast = new PepaMarkAst("Before :notice: after");
    ast.use([parserPlugin, visitorPlugin]);

    const paragraph = ast.ast.children[0];
    assert.equal(paragraph?.type, "paragraph");
    assert.deepEqual(
      paragraph?.type === "paragraph"
        ? paragraph.children.map((node) =>
            node.type === "text" ? node.value : node.type,
          )
        : [],
      ["BEFORE ", "NOTICE", " AFTER"],
    );

    ast.removePlugin(visitorPlugin);
    const unvisitedParagraph = ast.ast.children[0];
    assert.equal(unvisitedParagraph?.type, "paragraph");
    assert.deepEqual(
      unvisitedParagraph?.type === "paragraph"
        ? unvisitedParagraph.children.map((node) =>
            node.type === "text" ? node.value : node.type,
          )
        : [],
      ["Before ", "NOTICE", " after"],
    );
  });
});
