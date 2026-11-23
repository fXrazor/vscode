// A small HCL (Terraform language) reader and writer.
// The reader understands the structure (blocks, labels, attributes, lists, objects, strings,
// heredocs, comments) and keeps any expression it does not model as raw text, so nothing is
// silently dropped. It never evaluates anything.
import type { Value } from "./model.ts";

export interface HclBlock {
  type: string;
  labels: string[];
  attrs: Record<string, Value>;
  blocks: HclBlock[];
  /** Order in which attributes and blocks appeared. */
  order: string[];
}

export interface HclFile {
  blocks: HclBlock[];
  attrs: Record<string, Value>;
}

type Tok = { t: "id" | "str" | "num" | "heredoc" | "p" | "nl" | "eof"; v: string; s: number; e: number; raw?: boolean };

export class HclError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.line = line;
  }
}

function lineOf(src: string, pos: number) {
  let n = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      out.push({ t: "nl", v: "\n", s: i, e: i + 1 });
      i++;
    } else if (c === " " || c === "\t" || c === "\r") i++;
    else if (c === "#" || (c === "/" && src[i + 1] === "/")) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"') {
      const s = i;
      i++;
      let depth = 0;
      let raw = false;
      while (i < src.length) {
        const d = src[i]!;
        if (d === "\\") {
          i += 2;
          continue;
        }
        if ((d === "$" || d === "%") && src[i + 1] === "{" && src[i - 1] !== d) {
          raw = true;
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (d === "{") depth++;
          else if (d === "}") depth--;
          i++;
          continue;
        }
        if (d === '"') break;
        if (d === "\n") throw new HclError("Unterminated string", lineOf(src, s));
        i++;
      }
      i++;
      out.push({ t: "str", v: src.slice(s, i), s, e: i, raw });
    } else if (c === "<" && src[i + 1] === "<") {
      const s = i;
      const m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)\r?\n/.exec(src.slice(i));
      if (!m) {
        out.push({ t: "p", v: "<", s: i, e: i + 1 });
        i++;
        continue;
      }
      const marker = m[1]!;
      const bodyStart = i + m[0].length;
      const re = new RegExp(`^[ \\t]*${marker}[ \\t]*$`, "m");
      const rest = src.slice(bodyStart);
      const mm = re.exec(rest);
      if (!mm) throw new HclError("Unterminated heredoc", lineOf(src, s));
      const body = rest.slice(0, mm.index);
      i = bodyStart + mm.index + mm[0].length;
      out.push({ t: "heredoc", v: body.replace(/\r?\n$/, ""), s, e: i, raw: body.includes("${") });
    } else if (/[0-9]/.test(c)) {
      const s = i;
      while (i < src.length && /[0-9.eE+-]/.test(src[i]!) && !(src[i] === "." && !/[0-9]/.test(src[i + 1] ?? ""))) {
        if ((src[i] === "+" || src[i] === "-") && !/[eE]/.test(src[i - 1]!)) break;
        i++;
      }
      out.push({ t: "num", v: src.slice(s, i), s, e: i });
    } else if (/[A-Za-z_]/.test(c)) {
      const s = i;
      while (i < src.length && /[A-Za-z0-9_-]/.test(src[i]!)) i++;
      out.push({ t: "id", v: src.slice(s, i), s, e: i });
    } else {
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "=>", "..."].includes(two) || src.slice(i, i + 3) === "...") {
        const v = src.slice(i, i + 3) === "..." ? "..." : two;
        out.push({ t: "p", v, s: i, e: i + v.length });
        i += v.length;
      } else {
        out.push({ t: "p", v: c, s: i, e: i + 1 });
        i++;
      }
    }
  }
  out.push({ t: "eof", v: "", s: src.length, e: src.length });
  return out;
}

function unescape(lit: string) {
  return lit
    .slice(1, -1)
    .replace(/\\(["\\nrt])/g, (_, ch: string) => ({ n: "\n", r: "\r", t: "\t" })[ch] ?? ch)
    .replace(/\$\$\{/g, "${");
}

export function parseHcl(src: string): HclFile {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k]!;
  const next = () => toks[k++]!;
  const skipNl = () => {
    while (peek().t === "nl") k++;
  };
  const fail = (msg: string): never => {
    throw new HclError(msg, lineOf(src, peek().s));
  };

  function scanRaw(start: number): Expr {
    // Consume tokens until a newline/comma/closer at depth 0.
    let depth = 0;
    while (true) {
      const t = peek();
      if (t.t === "eof") break;
      if (depth === 0 && (t.t === "nl" || (t.t === "p" && [",", "}", "]", ")"].includes(t.v)))) break;
      if (t.t === "p" && ["{", "[", "("].includes(t.v)) depth++;
      if (t.t === "p" && ["}", "]", ")"].includes(t.v)) depth--;
      if (depth > 0 && t.t === "nl") {
        k++;
        continue;
      }
      k++;
    }
    const end = toks[k - 1]?.e ?? start;
    return { $expr: src.slice(start, end).trim() };
  }

  function atEnd() {
    const t = peek();
    return t.t === "nl" || t.t === "eof" || (t.t === "p" && [",", "}", "]", ")"].includes(t.v));
  }

  function expr(): Value {
    const start = peek().s;
    const save = k;
    const simple = simpleExpr();
    if (simple !== undefined && atEnd()) return simple;
    k = save;
    return scanRaw(start);
  }

  function simpleExpr(): Value | undefined {
    const t = peek();
    if (t.t === "str") {
      k++;
      if (!t.raw) return unescape(t.v);
      const inner = /^"\$\{([^{}"]*)\}"$/.exec(t.v);
      return { $expr: inner ? inner[1]!.trim() : t.v };
    }
    if (t.t === "heredoc") {
      k++;
      return t.raw ? { $expr: src.slice(t.s, t.e) } : t.v;
    }
    if (t.t === "num") {
      k++;
      return Number(t.v);
    }
    if (t.t === "p" && t.v === "-" && toks[k + 1]?.t === "num") {
      k += 2;
      return -Number(toks[k - 1]!.v);
    }
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") {
        k++;
        return t.v === "true";
      }
      if (t.v === "null") {
        k++;
        return null;
      }
      // traversal: a.b.c[0].d
      const s = t.s;
      k++;
      if (peek().t === "p" && peek().v === "(") return undefined; // function call
      while (true) {
        const p = peek();
        if (p.t === "p" && p.v === "." && (toks[k + 1]?.t === "id" || toks[k + 1]?.t === "num" || toks[k + 1]?.v === "*")) k += 2;
        else if (p.t === "p" && p.v === "[") {
          const save = k;
          k++;
          const idx = peek();
          if ((idx.t === "num" || idx.t === "str" || idx.v === "*") && toks[k + 1]?.v === "]") k += 2;
          else {
            k = save;
            break;
          }
        } else break;
      }
      return { $expr: src.slice(s, toks[k - 1]!.e) };
    }
    if (t.t === "p" && t.v === "[") {
      k++;
      const items: Value[] = [];
      skipNl();
      while (!(peek().t === "p" && peek().v === "]")) {
        if (peek().t === "eof") fail("Unclosed list");
        items.push(expr());
        skipNl();
        if (peek().t === "p" && peek().v === ",") k++;
        skipNl();
      }
      k++;
      return items;
    }
    if (t.t === "p" && t.v === "{") {
      k++;
      const obj: Record<string, Value> = {};
      skipNl();
      while (!(peek().t === "p" && peek().v === "}")) {
        if (peek().t === "eof") fail("Unclosed object");
        const key = next();
        let name = key.t === "str" ? unescape(key.v) : key.v;
        if (key.t === "p" && key.v === "(") {
          // (expression) keys are kept raw
          const s = key.s;
          let d = 1;
          while (d > 0 && peek().t !== "eof") {
            const x = next();
            if (x.v === "(") d++;
            if (x.v === ")") d--;
          }
          name = src.slice(s, toks[k - 1]!.e);
        }
        const sep = next();
        if (!(sep.t === "p" && (sep.v === "=" || sep.v === ":"))) return undefined;
        obj[name] = expr();
        skipNl();
        if (peek().t === "p" && peek().v === ",") k++;
        skipNl();
      }
      k++;
      return obj;
    }
    return undefined;
  }

  function body(closer: boolean): { attrs: Record<string, Value>; blocks: HclBlock[]; order: string[] } {
    const attrs: Record<string, Value> = {};
    const blocks: HclBlock[] = [];
    const order: string[] = [];
    while (true) {
      skipNl();
      const t = peek();
      if (t.t === "eof") {
        if (closer) fail("Missing closing }");
        break;
      }
      if (t.t === "p" && t.v === "}") {
        if (!closer) fail("Unexpected }");
        k++;
        break;
      }
      if (t.t !== "id") fail(`Unexpected "${t.v}"`);
      const name = next().v;
      if (peek().t === "p" && peek().v === "=") {
        k++;
        attrs[name] = expr();
        order.push(name);
        continue;
      }
      const labels: string[] = [];
      while (peek().t === "str" || peek().t === "id") {
        const l = next();
        labels.push(l.t === "str" ? unescape(l.v) : l.v);
      }
      if (!(peek().t === "p" && peek().v === "{")) fail(`Expected "{" after ${name}`);
      k++;
      const inner = body(true);
      blocks.push({ type: name, labels, ...inner });
      order.push(name);
    }
    return { attrs, blocks, order };
  }

  const top = body(false);
  return { blocks: top.blocks, attrs: top.attrs };
}

type Expr = { $expr: string };

/** Turn nested blocks into config values: one block → object, repeated → array. */
export function blockToConfig(b: HclBlock, repeatNames: Set<string> = new Set()): Record<string, Value> {
  const out: Record<string, Value> = { ...b.attrs };
  const groups = new Map<string, HclBlock[]>();
  for (const nb of b.blocks) groups.set(nb.type, [...(groups.get(nb.type) ?? []), nb]);
  for (const [name, list] of groups) {
    if (name === "lifecycle" || name === "dynamic") continue;
    const values = list.map((x) => blockToConfig(x, repeatNames));
    out[name] = list.length > 1 || repeatNames.has(name) ? values : values[0]!;
  }
  return out;
}

// ---------- Writer helpers ----------

export function quote(s: string) {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$\{/g, "$${")
    .replace(/%\{/g, "%%{")}"`;
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const key = (k: string) => (IDENT.test(k) ? k : quote(k));

/** Align `=` signs of consecutive single-line attributes, as terraform fmt does. */
export function alignBlock(lines: string[]): string[] {
  const out: string[] = [];
  let group: { indent: string; k: string; rest: string; idx: number }[] = [];
  const flush = () => {
    const width = Math.max(0, ...group.map((g) => g.k.length));
    for (const g of group) out[g.idx] = `${g.indent}${g.k.padEnd(width)} = ${g.rest}`;
    group = [];
  };
  lines.forEach((line, idx) => {
    out.push(line);
    const m = /^(\s*)([A-Za-z0-9_"-]+) = (.*)$/.exec(line);
    const multiOpen = m && /[[{(]$/.test(m[3]!);
    if (m && !multiOpen && (group.length === 0 || group[0]!.indent === m[1])) group.push({ indent: m[1]!, k: m[2]!, rest: m[3]!, idx });
    else {
      flush();
      if (m && !multiOpen) group.push({ indent: m[1]!, k: m[2]!, rest: m[3]!, idx });
    }
  });
  flush();
  return out;
}
