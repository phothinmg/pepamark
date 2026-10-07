import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { yaml } from "../src/yaml/index.js";

describe("yaml.parse", () => {
  it("parses scalar values into their corresponding JavaScript types", () => {
    const result = yaml.parse<{
      title: string;
      enabled: boolean;
      disabled: boolean;
      count: number;
      ratio: number;
      nothing: null;
      positiveInfinity: number;
      negativeInfinity: number;
      notANumber: number;
      created: Date;
    }>(`
title: "Pepamark"
enabled: true
disabled: false
count: -42
ratio: 3.14
nothing: null
positiveInfinity: .inf
negativeInfinity: -.inf
notANumber: .NaN
created: 2024-01-15
`);

    assert.deepEqual(
      {
        ...result,
        created: result.created.toISOString(),
        notANumber: Number.isNaN(result.notANumber),
      },
      {
        title: "Pepamark",
        enabled: true,
        disabled: false,
        count: -42,
        ratio: 3.14,
        nothing: null,
        positiveInfinity: Infinity,
        negativeInfinity: -Infinity,
        notANumber: true,
        created: "2024-01-15T00:00:00.000Z",
      },
    );
  });

  it("parses nested mappings and block sequences", () => {
    const result = yaml.parse(`
site:
  name: Pepamark
  settings:
    public: true
contributors:
  - name: Ada
    role: maintainer
  - name: Lin
    role: author
`);

    assert.deepEqual(result, {
      site: {
        name: "Pepamark",
        settings: { public: true },
      },
      contributors: [
        { name: "Ada", role: "maintainer" },
        { name: "Lin", role: "author" },
      ],
    });
  });

  it("parses flow collections, including nested collections and quoted commas", () => {
    const result = yaml.parse(`
tags: [yaml, "front, matter", [parser, test]]
metadata: {draft: false, views: 42, labels: [alpha, beta]}
emptyList: []
emptyObject: {}
`);

    assert.deepEqual(result, {
      tags: ["yaml", "front, matter", ["parser", "test"]],
      metadata: {
        draft: false,
        views: 42,
        labels: ["alpha", "beta"],
      },
      emptyList: [],
      emptyObject: {},
    });
  });

  it("parses block sequences containing scalar values", () => {
    const result = yaml.parse(`
values:
  - first
  - false
  - 42
  - null
`);

    assert.deepEqual(result, {
      values: ["first", false, 42, null],
    });
  });

  it("supports literal and folded block strings", () => {
    const result = yaml.parse(`
literal: |
  first line
  second line
folded: >
  first line
  second line
`);

    assert.deepEqual(result, {
      literal: "first line\nsecond line",
      folded: "first line second line",
    });
  });

  it("preserves hashes in quoted strings while removing trailing comments", () => {
    const result = yaml.parse(`
heading: "Release #1" # This is a comment
note: 'Ship #1'
`);

    assert.deepEqual(result, {
      heading: "Release #1",
      note: "Ship #1",
    });
  });

  it("resolves aliases to anchored mappings", () => {
    const result = yaml.parse(`
defaults: &defaults
  color: blue
  retries: 3
production: *defaults
`);

    assert.deepEqual(result, {
      defaults: {
        color: "blue",
        retries: 3,
      },
      production: {
        color: "blue",
        retries: 3,
      },
    });
  });

  it("ignores document markers, blank lines, and comments", () => {
    const result = yaml.parse(`
---
# A document comment
title: Pepamark # An inline comment

enabled: true
...
`);

    assert.deepEqual(result, {
      title: "Pepamark",
      enabled: true,
    });
  });
});
