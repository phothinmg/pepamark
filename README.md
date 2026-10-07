# Pepamark

Pepamark is a TypeScript Markdown parser and HTML renderer. It parses
Markdown into a typed AST, reads YAML front matter, supports GFM and
Kramdown extensions, and can render either an HTML fragment or a complete
HTML document.

## Installation

```sh
npm install pepamark
```

## Quick start

Create a `Pepamark` instance with Markdown, then read its `html`,
`ast`, or `frontmatter` properties.

```ts
import { Pepamark } from "pepamark";

const document = new Pepamark<{ title: string }>(`---
title: Welcome
---
# Hello, Pepamark!

This is **Markdown**.`);

console.log(document.frontmatter);
// { title: "Welcome" }

console.log(document.html);
// <!DOCTYPE html>...
```

To render only the HTML body content, use `fragment: true`:

```ts
const document = new Pepamark("# Hello", { fragment: true });

console.log(document.html);
// <h1>Hello</h1>
```

## API

### `Pepamark`

`new Pepamark<F>(markdown, options?)` is the high-level API. `F` describes
the expected shape of the YAML front matter.

| Property | Description |
| --- | --- |
| `ast` | Parsed Markdown document AST. |
| `frontmatter` | Parsed YAML front matter, or `undefined` when absent. |
| `html` | Rendered HTML document or fragment. |

### Options

The constructor accepts parser and renderer options:

| Option | Default | Description |
| --- | --- | --- |
| `gfm` | `true` | Enables GitHub Flavored Markdown extensions, including tables and task lists. |
| `kramdown` | `true` | Enables Kramdown attributes such as `{:#id .class key="value"}`. |
| `fileName` | `null` | Associates a source file name with the AST document. |
| `fragment` | `false` | Emits only body HTML instead of a complete HTML document. |
| `charset` | `true` | Includes `<meta charset="utf-8">` in full-document output. |
| `viewport` | `true` | Includes a viewport meta tag in full-document output. |
| `title` | `null` | Sets the full document's `<title>`. |
| `bodyClass` | `null` | Adds classes to the full document's `<body>`. |
| `style` | `null` | Adds inline CSS in a `<style>` element. |

For example:

```ts
const document = new Pepamark("# Guide", {
  title: "My guide",
  bodyClass: "documentation",
  style: "body { max-width: 72ch; margin: 2rem auto; }",
});
```

### Front matter

Use `frontmatter` when you only need YAML metadata and the Markdown body:

```ts
import { frontmatter } from "pepamark";

const result = frontmatter<{ draft: boolean; tags: string[] }>(`---
draft: false
tags: [docs, guide]
---
# Getting started`);

console.log(result.data);
// { draft: false, tags: ["docs", "guide"] }

console.log(result.content);
// # Getting started
```

When no opening and closing front-matter delimiters are present, `data` is an
empty object and `content` is the original input.

### YAML

The `yaml` export parses YAML independently:

```ts
import { yaml } from "pepamark";

const config = yaml.parse<{ enabled: boolean; retries: number }>(`
enabled: true
retries: 3
`);
```

### Plugins

Register AST visitors or parser plugins with `use()`. Plugins are reapplied
whenever the AST, front matter, or HTML is read. Remove a plugin by its name
with `remove()`.

```ts
import { Pepamark, type pepatype } from "pepamark";

const uppercaseText: pepatype.PepaMarkPlugin = {
  name: "uppercase-text",
  type: "ast",
  visitBlock() {
    return { recurse: true };
  },
  visitInline(node) {
    if (node.type === "text") {
      node.value = node.value.toUpperCase();
    }
    return {};
  },
};

const document = new Pepamark("Hello, world!", { fragment: true });
document.use(uppercaseText);

console.log(document.html);
// <p>HELLO, WORLD!</p>
```

## Development

Install dependencies:

```sh
npm install
```

Available commands:

| Command | Description |
| --- | --- |
| `npm test` | Run the Node.js test suite. |
| `npm run lint` | Check code with Oxlint. |
| `npm run lint:fix` | Apply Oxlint fixes. |
| `npm run fmt` | Format code with Oxfmt. |
| `npm run fmt:check` | Check formatting with Oxfmt. |
| `npm run build` | Build with Susee. |

## License

Licensed under the [Apache License 2.0](LICENSE).
