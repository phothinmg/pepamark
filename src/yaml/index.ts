/**
 * Parses YAML front matter into JavaScript values.
 */
export const yaml = (() => {
  const regex = {
    regLevel: new RegExp("^([\\s\\-]+)"),
    invalidLine: new RegExp("^\\-\\-\\-|^\\.\\.\\.|^\\s*#.*|^\\s*$"),
    dashesString: new RegExp('^\\s*\\"([^\\"]*)\\"\\s*$'),
    quotesString: new RegExp("^\\s*\\\'([^\\\']*)\\\'\\s*$"),
    float: new RegExp("^[+-]?[0-9]+\\.[0-9]+(e[+-]?[0-9]+(\\.[0-9]+)?)?$"),
    integer: new RegExp("^[+-]?[0-9]+$"),
    array: new RegExp("^\\[\\s*(.*)\\s*\\]$"),
    map: new RegExp("^\\{\\s*(.*)\\s*\\}$"),
    key_value: new RegExp("([a-z0-9_-][ a-z0-9_-]*):( .+)", "i"),
    single_key_value: new RegExp("^([a-z0-9_-][ a-z0-9_-]*):( .+?)$", "i"),
    key: new RegExp("([a-z0-9_-][ a-z0-9_-]+):( .+)?", "i"),
    item: new RegExp("^-\\s+"),
    trim: new RegExp("^\\s+|\\s+$"),
    comment: new RegExp("([^\\\'\\\"#]+([\\\'\\\"][^\\\'\\\"]*[\\\'\\\"])*)*(#.*)?"),
  };

  const errors: string[] = [];
  const reference_blocks: { [key: string]: any } = {};

  function preProcess(str: string): string {
    let lines = str.split("\n");
    const r = regex["comment"];
    let m: RegExpMatchArray | null = null;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i] as string;
      if ((m = line.match(r))) {
        if (typeof m[3] !== "undefined") {
          line = m[0].slice(0, m[0].length - m[3].length);
        }
      }
      lines[i] = line;
    }
    return lines.join("\n");
  }

  class Block {
    parent: Block | null;
    level: number;
    length: number;
    lines: string[];
    children: Block[];
    constructor(lvl: number) {
      this.parent = null;
      this.level = lvl;
      this.length = 0;
      this.lines = [];
      this.children = [];
    }
    addChild(obj: Block) {
      this.children.push(obj);
      obj.parent = this;
      ++this.length;
    }
  }

  function parser(str: string) {
    const regLevel = regex["regLevel"];
    const invalidLine = regex["invalidLine"];
    let lines = str.split("\n");
    let m: RegExpMatchArray | null = null;
    let level = 0;
    let curLevel = 0;

    let blocks: Block[] = [];

    const result = new Block(-1);
    let currentBlock = new Block(0);
    result.addChild(currentBlock);

    const levels: number[] = [];
    let line = "";

    blocks.push(currentBlock);
    levels.push(level);

    for (var i = 0, len = lines.length; i < len; ++i) {
      line = lines[i] as string;

      if (line.match(invalidLine)) {
        continue;
      }

      if ((m = regLevel.exec(line))) {
        level = (m[1] as string).length;
      } else level = 0;

      if (level > curLevel) {
        var oldBlock = currentBlock;
        currentBlock = new Block(level);
        oldBlock.addChild(currentBlock);
        blocks.push(currentBlock);
        levels.push(level);
      } else if (level < curLevel) {
        var added = false;

        var k = levels.length - 1;
        for (; k >= 0; --k) {
          if (levels[k] == level) {
            currentBlock = new Block(level);
            blocks.push(currentBlock);
            levels.push(level);
            if ((blocks[k] as Block).parent != null)
              ((blocks[k] as Block).parent as Block).addChild(currentBlock);
            added = true;
            break;
          }
        }

        if (!added) {
          errors.push("Error: Invalid indentation at line " + i + ": " + line);
          return;
        }
      }

      currentBlock.lines.push(line.replace(regex["trim"], ""));
      curLevel = level;
    }

    return result;
  }

  type Value = boolean | number | Record<string, any> | string | null;
  type ValueArray = Value[];

  function processValue(val: string): Value | ValueArray {
    val = val.replace(regex["trim"], "");
    let m: RegExpMatchArray | null | number = null;

    if (val === "true") {
      return true;
    } else if (val === "false") {
      return false;
    } else if (val === ".NaN") {
      return Number.NaN;
    } else if (val === "null") {
      return null;
    } else if (val === ".inf") {
      return Number.POSITIVE_INFINITY;
    } else if (val === "-.inf") {
      return Number.NEGATIVE_INFINITY;
    } else if ((m = val.match(regex["dashesString"]))) {
      return m[1] as string;
    } else if ((m = val.match(regex["quotesString"]))) {
      return m[1] as string;
    } else if ((m = val.match(regex["float"]))) {
      return parseFloat(m[0]);
    } else if ((m = val.match(regex["integer"]))) {
      return parseInt(m[0]);
    } else if (!isNaN((m = Date.parse(val)))) {
      return new Date(m);
    } else if ((m = val.match(regex["single_key_value"]))) {
      const res: Record<string, any> = {};
      res[m[1] as string] = processValue(m[2] as string);
      return res;
    } else if ((m = val.match(regex["array"]))) {
      let count = 0;
      let c = " ";
      let res = [];
      let content = "";
      let str: string | boolean = false;
      for (var j = 0, lenJ = (m[1] as string).length; j < lenJ; ++j) {
        c = (m[1] as string)[j] as string;
        if (c == "'" || c == '"') {
          if (str === false) {
            str = c;
            content += c;
            continue;
          } else if ((c == "'" && str == "'") || (c == '"' && str == '"')) {
            str = false;
            content += c;
            continue;
          }
        } else if (str === false && (c == "[" || c == "{")) {
          ++count;
        } else if (str === false && (c == "]" || c == "}")) {
          --count;
        } else if (str === false && count == 0 && c == ",") {
          res.push(processValue(content));
          content = "";
          continue;
        }

        content += c;
      }

      if (content.length > 0) res.push(processValue(content));
      return res;
    } else if ((m = val.match(regex["map"]))) {
      let count = 0;
      let c = " ";
      let res = [];
      let content = "";
      let str: string | boolean = false;
      for (var j = 0, lenJ = (m[1] as string).length; j < lenJ; ++j) {
        c = (m[1] as string)[j] as string;
        if (c == "'" || c == '"') {
          if (str === false) {
            str = c;
            content += c;
            continue;
          } else if ((c == "'" && str == "'") || (c == '"' && str == '"')) {
            str = false;
            content += c;
            continue;
          }
        } else if (str === false && (c == "[" || c == "{")) {
          ++count;
        } else if (str === false && (c == "]" || c == "}")) {
          --count;
        } else if (str === false && count == 0 && c == ",") {
          res.push(content);
          content = "";
          continue;
        }

        content += c;
      }

      if (content.length > 0) res.push(content);

      let newRes: Record<string, any> = {};
      for (var j = 0, lenJ = res.length; j < lenJ; ++j) {
        if ((m = (res[j] as string).match(regex["key_value"]))) {
          newRes[m[1] as string] = processValue(m[2] as string);
        }
      }

      return newRes;
    } else {
      return val;
    }
  }

  function processFoldedBlock(block: Block) {
    let lines = block.lines;
    let children = block.children;
    let str = lines.join(" ");
    let chunks = [str];
    for (var i = 0, len = children.length; i < len; ++i) {
      chunks.push(processFoldedBlock(children[i] as Block));
    }
    return chunks.join("\n");
  }
  function processLiteralBlock(block: Block) {
    let lines = block.lines;
    let children = block.children;
    let str = lines.join("\n");
    for (var i = 0, len = children.length; i < len; ++i) {
      str += processLiteralBlock(children[i] as Block);
    }
    return str;
  }
  function processBlock(blocks: Block[]) {
    let m: RegExpMatchArray | null = null;
    let res: Record<string, any> = {};
    let lines: string[] | null = null;
    let children: any[] | null = null;
    let currentObj: Record<string, any> | null = null;

    let level = -1;

    let processedBlocks = [];

    var isMap = true;

    for (var j = 0, lenJ = blocks.length; j < lenJ; ++j) {
      if (level != -1 && level != (blocks[j] as Block).level) continue;

      processedBlocks.push(j);

      level = (blocks[j] as Block).level;
      lines = (blocks[j] as Block).lines;
      children = (blocks[j] as Block).children;
      currentObj = null;

      for (var i = 0, len = lines.length; i < len; ++i) {
        let line = lines[i] as string;

        if ((m = line.match(regex["key"]))) {
          let key = m[1] as string;

          if (key[0] == "-") {
            key = key.replace(regex["item"], "");
            if (isMap) {
              isMap = false;
              if (typeof res.length === "undefined") {
                res = [];
              }
            }
            if (currentObj != null) res.push(currentObj);
            currentObj = {};
            isMap = true;
          }

          if (typeof m[2] != "undefined") {
            let value = m[2].replace(regex["trim"], "");
            if (value[0] == "&") {
              let nb = processBlock(children);
              if (currentObj != null) currentObj[key] = nb;
              else res[key] = nb;
              reference_blocks[value.slice(1) as string] = nb;
            } else if (value[0] == "|") {
              if (currentObj != null) currentObj[key] = processLiteralBlock(children.shift());
              else res[key] = processLiteralBlock(children.shift());
            } else if (value[0] == "*") {
              let v = value.slice(1);
              let no: Record<string, any> = {};

              if (typeof reference_blocks[v] == "undefined") {
                errors.push("Reference '" + v + "' not found!");
              } else {
                for (var k in reference_blocks[v]) {
                  no[k] = reference_blocks[v][k];
                }

                if (currentObj != null) currentObj[key] = no;
                else res[key] = no;
              }
            } else if (value[0] == ">") {
              if (currentObj != null) currentObj[key] = processFoldedBlock(children.shift());
              else res[key] = processFoldedBlock(children.shift());
            } else {
              if (currentObj != null) currentObj[key] = processValue(value);
              else res[key] = processValue(value);
            }
          } else {
            if (currentObj != null) currentObj[key] = processBlock(children);
            else res[key] = processBlock(children);
          }
        } else if (line.match(/^-\s*$/)) {
          if (isMap) {
            isMap = false;
            if (typeof res.length === "undefined") {
              res = [];
            }
          }
          if (currentObj != null) res.push(currentObj);
          currentObj = {};
          isMap = true;
          continue;
        } else if ((m = line.match(/^-\s*(.*)/))) {
          if (currentObj != null) currentObj.push(processValue(m[1] as string));
          else {
            if (isMap) {
              isMap = false;
              if (typeof res.length === "undefined") {
                res = [];
              }
            }
            res.push(processValue(m[1] as string));
          }
          continue;
        }
      }

      if (currentObj != null) {
        if (isMap) {
          isMap = false;
          if (typeof res.length === "undefined") {
            res = [];
          }
        }
        res.push(currentObj);
      }
    }

    for (var j = processedBlocks.length - 1; j >= 0; --j) {
      blocks.splice.call(blocks, processedBlocks[j] as number, 1);
    }

    return res;
  }

  function semanticAnalysis(blocks: Block) {
    let res = processBlock(blocks.children);
    return res;
  }

  /**
   * Parses a YAML document.
   *
   * @typeParam T - Expected shape of the parsed document.
   * @param str - YAML source text.
   * @returns The parsed YAML document.
   */
  function parse<T = Record<string, any>>(str: string): T {
    let pre = preProcess(str);
    let doc = parser(pre);
    let res = {} as T;
    if (doc) {
      res = semanticAnalysis(doc) as T;
    }
    return res;
  }
  return { parse };
})();
