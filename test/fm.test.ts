import { describe, it } from "node:test";
import assert from "node:assert";
import { frontmatter } from "../src/fm/index.js";

describe("frontmatter", () => {
  it("parses YAML metadata and returns the markdown body", () => {
    const result = frontmatter<{
      title: string;
      draft: boolean;
      tags: string[];
    }>("---\ntitle: Getting started\ndraft: false\ntags: [docs, guide]\n---\n# Getting started");

    assert.deepStrictEqual(result.data, {
      title: "Getting started",
      draft: false,
      tags: ["docs", "guide"],
    });
    assert.strictEqual(result.content, "# Getting started");
  });

  it("returns the original document when front matter is absent or unclosed", () => {
    const plainMarkdown = "# Title\n\nBody text";
    const unclosedFrontMatter = "---\ntitle: Draft\n# Title";

    assert.deepStrictEqual(frontmatter(plainMarkdown), {
      data: {},
      content: plainMarkdown,
    });
    assert.deepStrictEqual(frontmatter(unclosedFrontMatter), {
      data: {},
      content: unclosedFrontMatter,
    });
  });

  it("does not treat body horizontal rules or delimiter-like text as front matter", () => {
    const markdown = "---\ntitle: Notes\n---\nFirst paragraph.\n\n---\n\n---not-a-delimiter";

    assert.deepStrictEqual(frontmatter(markdown), {
      data: { title: "Notes" },
      content: "First paragraph.\n\n---\n\n---not-a-delimiter",
    });
  });
});
