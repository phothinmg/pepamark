import type { pepatype } from "../type/index.js";

export function parseAttrs(s: string): [pepatype.Attributes, number] | undefined {
  s = s.trimStart();
  if (!s.startsWith("{")) {
    return undefined;
  }

  // Find the matching closing `}`.
  const chars = [...s];
  let depth = 0;
  let end = 0;
  let inString: string | undefined;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inString !== undefined) {
      if (c === inString) {
        inString = undefined;
      }
    } else {
      if (c === '"' || c === "'") {
        inString = c;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }

  if (end === 0) {
    return undefined;
  }

  // Kramdown block attribute syntax is `{:...}` — skip the optional `:`
  // immediately after the opening `{`.
  const innerStart = chars[1] === ":" ? 2 : 1;
  const inner = chars.slice(innerStart, end - 1).join("");
  const attrs = parseAttrTokens(inner);
  return [attrs, end];
}

/** Parse the tokens inside `{...}`. */
function parseAttrTokens(inner: string): pepatype.Attributes {
  const attrs: pepatype.Attributes = {};
  const chars = [...inner];
  let i = 0;

  while (i < chars.length) {
    // skip whitespace
    while (i < chars.length && /\s/.test(chars[i] as string)) {
      i += 1;
    }
    if (i >= chars.length) {
      break;
    }

    const c = chars[i] as string;
    if (c === "#") {
      // ID: #id
      i += 1;
      const start = i;
      while (i < chars.length && isIdentChar(chars[i] as string)) {
        i += 1;
      }
      if (i > start) {
        attrs.id = chars.slice(start, i).join("");
      }
    } else if (c === ".") {
      // Class: .class
      i += 1;
      const start = i;
      while (i < chars.length && isIdentChar(chars[i] as string)) {
        i += 1;
      }
      if (i > start) {
        const className = chars.slice(start, i).join("");
        (attrs.classes ??= []).push(className);
      }
    } else if (isIdentStart(c)) {
      // key="value" or key='value'
      const keyStart = i;
      while (i < chars.length && isIdentChar(chars[i] as string)) {
        i += 1;
      }
      const key = chars.slice(keyStart, i).join("");

      // skip whitespace
      while (i < chars.length && /\s/.test(chars[i] as string)) {
        i += 1;
      }

      if (i < chars.length && chars[i] === "=") {
        i += 1;
        while (i < chars.length && /\s/.test(chars[i] as string)) {
          i += 1;
        }
        if (i < chars.length && (chars[i] === '"' || chars[i] === "'")) {
          const q = chars[i];
          i += 1;
          const valStart = i;
          while (i < chars.length && chars[i] !== q) {
            i += 1;
          }
          const val = chars.slice(valStart, i).join("");
          if (i < chars.length) {
            i += 1; // skip closing quote
          }
          pushAttr(attrs, key, val);
        } else {
          // unquoted value
          const valStart = i;
          while (i < chars.length && !/\s/.test(chars[i] as string)) {
            i += 1;
          }
          const val = chars.slice(valStart, i).join("");
          if (val !== "") {
            pushAttr(attrs, key, val);
          }
        }
      } else {
        // bare key → boolean attribute
        pushAttr(attrs, key, "");
      }
    } else {
      i += 1; // skip unknown char
    }
  }

  return attrs;
}

/** Push a key-value pair into `attrs.attributes`, initialising the array
 * if it is still missing. */
function pushAttr(attrs: pepatype.Attributes, key: string, val: string): void {
  (attrs.attributes ??= []).push([key, val]);
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c) || c === "-";
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c) || c === "-";
}
