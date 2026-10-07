import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AstToHtml, renderDocumentHtml } from "../src/html/index.js";
import type { pepatype } from "../src/type/index.js";

const pos: pepatype.Span = {
  start: { line: 0, column: 0, offset: 0 },
  end: { line: 0, column: 0, offset: 0 },
};

function document(children: pepatype.Block[]): pepatype.Document {
  return { type: "root", pos, children };
}

describe("AstToHtml", () => {
  it("renders a complete document with configurable head and body content", () => {
    const doc = document([
      {
        type: "heading",
        level: 1,
        pos,
        attrs: {
          id: 'welcome"&',
          classes: ["hero", "primary"],
          attributes: [["data-label", "<start>"]],
        },
        children: [{ type: "text", value: `Welcome <&>"'`, pos }],
      },
    ]);

    assert.equal(
      renderDocumentHtml(doc, {
        title: `Docs <&>"'`,
        bodyClass: 'page"&',
        style: "body { color: red; }",
      }),
      `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Docs &lt;&amp;&gt;&quot;&#39;</title>
<style>
body { color: red; }
</style>
</head>
<body class="page&quot;&amp;">
<h1 id="welcome&quot;&amp;" class="hero primary" data-label="&lt;start&gt;">Welcome &lt;&amp;&gt;&quot;&#39;</h1>
</body>
</html>
`,
    );
  });

  it("renders inline nodes and safely escapes their text and attribute values", () => {
    const doc = document([
      {
        type: "paragraph",
        pos,
        children: [
          { type: "text", value: "<text>", pos },
          {
            type: "emphasis",
            level: "italic",
            pos,
            children: [{ type: "text", value: "italic", pos }],
          },
          {
            type: "emphasis",
            level: "bold",
            pos,
            children: [{ type: "text", value: "bold", pos }],
          },
          { type: "code", code: "<code>", pos },
          { type: "html_inline", html: "<mark>raw</mark>", pos },
          {
            type: "strikethrough",
            pos,
            children: [{ type: "text", value: "gone", pos }],
          },
          { type: "hard_break", pos },
          { type: "soft_break", pos },
          { type: "image", url: '/a?x="<>&', alt: "<alt>", title: '"caption"', pos },
          {
            type: "link",
            url: '/guide?x="<>&',
            title: '"guide"',
            autolink: false,
            pos,
            text: [{ type: "text", value: "<link>", pos }],
          },
          {
            type: "link_reference",
            label: "guide",
            url: "/reference",
            title: undefined,
            pos,
            text: [{ type: "text", value: "reference", pos }],
          },
        ],
      },
    ]);

    assert.equal(
      renderDocumentHtml(doc, true),
      `<p>&lt;text&gt;<em>italic</em><strong>bold</strong><code>&lt;code&gt;</code><mark>raw</mark><del>gone</del><br>

<img src="/a?x=&quot;&lt;&gt;&amp;" alt="&lt;alt&gt;" title="&quot;caption&quot;"><a href="/guide?x=&quot;&lt;&gt;&amp;" title="&quot;guide&quot;">&lt;link&gt;</a><a href="/reference">reference</a></p>
`,
    );
  });

  it("renders nested blocks, lists, tables, raw HTML, and comments", () => {
    const doc = document([
      { type: "code_block", lang: "ts<&", code: "<code>&", pos },
      {
        type: "block_quote",
        pos,
        children: [
          {
            type: "paragraph",
            pos,
            children: [{ type: "text", value: "quoted", pos }],
          },
        ],
      },
      {
        type: "list",
        ordered: false,
        pos,
        items: [
          {
            pos,
            children: [
              {
                type: "paragraph",
                pos,
                children: [{ type: "text", value: "tight", pos }],
              },
            ],
          },
          {
            task: "checked",
            pos,
            children: [
              {
                type: "paragraph",
                pos,
                children: [{ type: "text", value: "done", pos }],
              },
            ],
          },
          {
            task: "unchecked",
            pos,
            children: [
              {
                type: "paragraph",
                pos,
                children: [{ type: "text", value: "loose", pos }],
              },
              { type: "thematic_break", pos },
            ],
          },
        ],
      },
      { type: "thematic_break", pos },
      { type: "html_block", html: "<aside>raw</aside>", pos },
      {
        type: "table",
        pos,
        attrs: { classes: ["data"] },
        table: {
          alignments: ["left", "center", "right"],
          header: {
            cells: [
              { children: [{ type: "text", value: "left", pos }] },
              { children: [{ type: "text", value: "center", pos }] },
              { children: [{ type: "text", value: "right", pos }] },
            ],
          },
          rows: [
            {
              cells: [
                { children: [{ type: "text", value: "a", pos }] },
                { children: [{ type: "text", value: "b", pos }] },
                { children: [{ type: "text", value: "c", pos }] },
              ],
            },
          ],
        },
      },
      {
        type: "link_reference_definition",
        label: "hidden",
        url: "/hidden",
        pos,
      },
      { type: "comment", value: " visible in source ", pos },
    ]);

    assert.equal(
      new AstToHtml({ fragment: true, charset: true, viewport: true }).renderDocumentOwned(doc),
      `<pre><code class="language-ts&lt;&amp;">&lt;code&gt;&amp;</code></pre>
<blockquote>
<p>quoted</p>
</blockquote>
<ul>
<li>tight</li>
<li class="task-list-item" data-checked="true"><input type="checkbox" class="task-list-item-checkbox" checked disabled> done</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> 
<p>loose</p>
<hr>
</li>
</ul>
<hr>
<aside>raw</aside>
<table class="data">
<thead>
<tr>
<th>left</th>
<th style="text-align: center">center</th>
<th style="text-align: right">right</th>
</tr>
</thead>
<tbody>
<tr>
<td>a</td>
<td style="text-align: center">b</td>
<td style="text-align: right">c</td>
</tr>
</tbody>
</table>
<!--  visible in source  -->
`,
    );
  });

  it("honors disabled full-document metadata and preserves incremental output", () => {
    const doc = document([
      {
        type: "paragraph",
        pos,
        children: [{ type: "text", value: "first", pos }],
      },
    ]);
    const renderer = new AstToHtml({ charset: false, viewport: false });

    renderer.renderDocument(doc);
    renderer.renderBlock({
      type: "paragraph",
      pos,
      children: [{ type: "text", value: "second", pos }],
    });

    assert.equal(
      renderer.finish(),
      `<!DOCTYPE html>
<html>
<head>
</head>
<body>
<p>first</p>
</body>
</html>
<p>second</p>
`,
    );
  });
});
