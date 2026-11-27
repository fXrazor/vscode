/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Adapted from user-owned CloudLab Forge apps/web/scripts/build-provider-index.ts.
// Documentation parsing infers types; it is not an executable provider schema or validator.
import type { AttrDef, AttrType } from '../src/cloudlab-core/catalog/types.ts';
interface Bullet {
  name: string;
  text: string;
  indent: number;
  children: Bullet[];
}

interface Page {
  front: Record<string, string>;
  args: Map<string, Bullet[]>; // "" = top level, otherwise block name
  attrs: string[];
}

function frontMatter(src: string) {
  const out: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m) return out;
  const lines = m[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (value === "|-" || value === "|" || value === ">-") {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) parts.push(lines[++i]!.trim());
      value = parts.join(" ");
    }
    out[kv[1]!] = value.replace(/^["']|["']$/g, "");
  }
  return out;
}

const BLOCK_START =
  /(?:^|>)\s*(?:an?|the|each)\s+`([a-z0-9_]+)`\s+(?:(?:configuration\s+|nested\s+|object\s+)?(?:blocks?|objects?)\s+)?(?:supports|contains|accepts|has|exports|requires|is|are|includes|support)/i;
const HEADING = /^(#{2,6})\s+(.*)$/;
const NOT_BLOCK_HEADINGS = /^(required|optional|arguments?|argument reference|arguments? reference|required arguments|optional arguments|timeouts?|import|example|attributes?)/i;

function parse(src: string): Page {
  const front = frontMatter(src);
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const lines = body.split(/\r?\n/);
  const documentedNames = new Set([...body.matchAll(/^\s*[-*]\s+`([a-zA-Z0-9_]+)`/gm)].map(match => match[1]));
  const args = new Map<string, Bullet[]>();
  const attrs: string[] = [];
  let mode: "none" | "args" | "attrs" = "none";
  let section = "";
  let inFence = false;
  let current: Bullet | undefined;
  let parentBullet: Bullet | undefined;

  const list = (name: string) => {
    let l = args.get(name);
    if (!l) args.set(name, (l = []));
    return l;
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if ((raw.match(/```/g) ?? []).length > 1) continue; // An inline fenced example is not an open block.
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING.exec(raw);
    if (h) {
      const level = h[1]!.length;
      const title = h[2]!.replace(/`/g, "").trim();
      current = undefined;
      parentBullet = undefined;
      if (level === 2) {
        if (/^arguments?\s+reference/i.test(title)) (mode = "args"), (section = "");
        else if (/^attributes?\s+reference/i.test(title)) mode = "attrs";
        else if (/^timeouts?$/i.test(title)) (mode = "args"), (section = "timeouts");
        else if (mode === "args" && documentedNames.has(title.toLowerCase().replace(/\s+(?:blocks?|arguments?|objects?)$/i, '').replace(/\W+/g, '_'))) section = title.toLowerCase().replace(/\s+(?:blocks?|arguments?|objects?)$/i, '').replace(/\W+/g, '_');
        else mode = "none";
        continue;
      }
      if (mode === "args") {
        if (/^timeouts?\b/i.test(title)) {
          section = "timeouts";
          continue;
        }
        const normal = title.replace(/\s+(?:configuration\s+)?(?:blocks?|arguments?|objects?)$/i, '').toLowerCase().replace(/\W+/g, '_');
        const name = /^([a-z0-9_]+)(?:\s+(?:configuration\s+)?(?:blocks?|arguments?|objects?))?\s*$/i.exec(title)?.[1] ?? (documentedNames.has(normal) ? normal : undefined);
        if (name && !NOT_BLOCK_HEADINGS.test(title)) section = name.toLowerCase();
        else if (/^(required|optional)\b/i.test(title)) section = ""; // "Required Arguments" etc.
      } else if (mode === "attrs" && level >= 3) mode = "none";
      continue;
    }
    if (mode === "none") continue;
    // Official pages sometimes document several argument names with one shared block body.
    const shared = /^(?:The|Each)\s+(.+?)\s+(?:configuration\s+)?blocks?\s+supports?\b/i.exec(raw.trim());
    const sharedNames = shared ? [...shared[1]!.matchAll(/`([a-z0-9_]+)`/g)].map(match => match[1]!) : [];
    if (mode === 'args' && sharedNames.length > 1 && sharedNames.every(name => documentedNames.has(name))) {
      section = sharedNames[0]!;
      const fields = list(section);
      for (const name of sharedNames.slice(1)) args.set(name, fields);
      current = undefined;
      parentBullet = undefined;
      continue;
    }
    const start = BLOCK_START.exec(raw);
    if (start && !/^\s*[*-]\s+`/.test(raw)) {
      if (mode === "args") section = start[1]!.toLowerCase();
      else mode = "none"; // nested attribute blocks are not top-level exports
      current = undefined;
      parentBullet = undefined;
      continue;
    }
    const b = /^(\s*)[*-]\s+`([a-zA-Z0-9_.]+)`\s*(?:[-–:]\s*)?(.*)$/.exec(raw);
    if (b) {
      const indent = b[1]!.replace(/\t/g, "    ").length;
      const bullet: Bullet = { name: b[2]!, text: b[3]!.trim(), indent, children: [] };
      if (mode === "attrs") {
        if (indent === 0) attrs.push(bullet.name);
        current = undefined;
        continue;
      }
      if (indent >= 2 && parentBullet && indent > parentBullet.indent) parentBullet.children.push(bullet);
      else {
        list(section).push(bullet);
        parentBullet = bullet;
      }
      current = bullet;
      continue;
    }
    if (current && mode === "args") {
      const t = raw.trim();
      if (!t) continue;
      if (/^\s+/.test(raw) || !/^[-*#<|]/.test(t)) {
        if (/^\s+/.test(raw)) current.text += ` ${t}`;
        else current = undefined; // free paragraph after the list
      }
    }
  }
  return { front, args, attrs };
}

// ---------- Inference ----------

const ACRONYMS = new Set(
  "vpc ip dns sql nat vm api iam kms s3 ec2 lb acm ecs eks ssl tls http https id arn ssh cdn waf gke vpn sns sqs ebs efs rds elb alb nlb mq ad aad tcp udp cidr ipv4 ipv6 bgp mssql mysql nsg ddos sso ami dms ses iot ml ai gpu cpu os url uri arc avs hdinsight".split(" "),
);
const titleCase = (s: string) =>
  s
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

function shortDescription(text: string) {
  const t = clean(text.replace(/^\(([^)]*)\)\s*/, "").replace(/Structure is documented below\.?/i, ""));
  const first = /^(.{20,220}?[.!?])(\s|$)/.exec(t)?.[1] ?? t.slice(0, 220);
  return first.length < t.length && !first.endsWith(".") ? `${first}…` : first;
}

function flagsOf(text: string) {
  const m = /^\(([^)]*)\)/.exec(text.trim()) ?? /\((Required|Optional)[^)]*\)/i.exec(text);
  const f = (m?.[1] ?? m?.[0] ?? "").toLowerCase();
  return {
    required: /\brequired\b/.test(f) && !/\boptional\b/.test(f),
    deprecated: /deprecated/.test(f) || /^\s*\(?[^)]*\)?\s*\**deprecated/i.test(text),
    known: /required|optional/.test(f),
  };
}

function valuesIn(text: string) {
  const m =
    /(?:possible|valid|allowed|supported|accepted)\s+values?\s*(?:are|is|include|includes|for this field are)?\s*:?\s*((?:`[^`]+`\s*(?:,|\band\b|\bor\b|,\s*and|,\s*or)?\s*)+)/i.exec(text) ??
    /(?:must be|can be|should be)\s+(?:one of|either)\s*:?\s*((?:`[^`]+`\s*(?:,|\band\b|\bor\b|,\s*and|,\s*or)?\s*)+)/i.exec(text);
  if (!m) return undefined;
  const vals = [...m[1]!.matchAll(/`([^`]+)`/g)].map((x) => x[1]!).filter((v) => v.length < 80);
  return vals.length >= 2 && vals.length <= 60 ? [...new Set(vals)] : undefined;
}

function defaultIn(text: string) {
  return /defaults?\s*(?:to|is|value is|:)\s*`([^`]+)`/i.exec(text)?.[1];
}

function inferType(b: Bullet, blockNames: Set<string>): { type: AttrType; repeat?: boolean } {
  const t = clean(b.text).toLowerCase();
  const n = b.name;
  // Provider-level default_tags prose mentions a block, but the resource argument is a map.
  if (n === 'tags' || n === 'labels') return { type: 'map' };
  const blockish =
    b.children.length > 0 ||
    (blockNames.has(n) && !/^(\([^)]*\)\s*)?(a |an )?(list|set|map|mapping) of (strings|numbers|ids|arns|names)\b/.test(t)) ||
    /\b(configuration )?blocks?\b.*(below|defined|documented)|(one or more|a|an|list of|set of)\s+`[a-z0-9_]+`\s+blocks?/.test(t);
  if (blockish) {
    const repeat = /(one or more|list of|set of|zero or more|multiple|array of|repeated|can be specified (more than once|multiple)|blocks\b|up to \d+)/.test(t);
    return { type: "block", repeat };
  }
  if (n === "tags" || n === "labels" || /^(a |an )?(mapping|map)\b|\bmap of\b|key[- ]value pairs?/.test(t)) return { type: "map" };
  if (/^(a |an )?(list|set|array)\b|\blist of\b|\bset of\b|\barray of\b|\bone or more\b/.test(t) || /_ids$|_arns$|_names$|s_list$/.test(n))
    return { type: "list" };
  const options = valuesIn(b.text);
  const boolOptions = !!options?.every((v) => v === "true" || v === "false");
  if (options && !boolOptions) return { type: "string" };
  const numericName =
    /(_count|_in_(gb|mb|tb|seconds|days|minutes|hours)|_(size|size_gb|size_in_gb)|^port|_port|_days|_seconds|_minutes|_hours|^count|_capacity|^priority|_priority|_percentage|_percent|^weight|_weight|_limit|_number)$|^(max|min)_[a-z_]*(count|size|capacity|seconds|minutes|hours|days|percent|percentage|length|number|instances|nodes|replicas)$/.test(n);
  if (numericName) return { type: "number" };
  if (
    boolOptions ||
    /(_enabled|_enable|_disabled)$|^(enable|is|use|allow|disable|skip|force|has|should)_|^(enabled|enable|disabled|rollback)$/.test(n) ||
    /\b(boolean|true or false|`true` or `false`|`true`, `false`)\b|defaults? to `(true|false)`|^(\([^)]*\)\s*)?(whether|indicates whether|determines whether|specifies whether|controls whether|should|if set to `?true`?|set to `?true`? to|a flag)\b/.test(t)
  )
    return { type: "bool" };
  if (/\b(number of|integer|in seconds|in minutes|in hours|in days|between `?-?\d+`? and `?-?\d+`?)\b/.test(t)) return { type: "number" };
  return { type: "string" };
}

const SENSITIVE = /(^|_)(password|passphrase|secret|token|private_key|access_key|secret_key|shared_key|connection_string|client_secret|sas)(_|$)/;
const NOT_SENSITIVE = /(_id|_ids|_name|_arn|_uri|_url|_endpoint|_version|_enabled|_type|_policy|_expiration|_length|_count|_rotation|_mode|_lifetime|_ttl|_duration|_header|_location|_source)$/;

function coerce(type: AttrType, v: string | undefined): unknown {
  if (v === undefined) return undefined;
  if (type === "bool") return v === "true" ? true : v === "false" ? false : undefined;
  if (type === "number") return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;
  if (type === "string") return v;
  return undefined;
}

function toAttrs(list: Bullet[], page: Page, seen: Set<string>, depth: number): AttrDef[] {
  const blockNames = new Set([...page.args.keys()].filter(Boolean));
  const out: AttrDef[] = [];
  const names = new Set<string>();
  for (const b of list) {
    if (names.has(b.name) || b.name.includes(".")) continue;
    names.add(b.name);
    const flags = flagsOf(b.text);
    const { type, repeat } = inferType(b, blockNames);
    const attr: AttrDef = { name: b.name, type, description: shortDescription(b.text) || titleCase(b.name) };
    if (flags.required) attr.required = true;
    if (flags.deprecated) attr.deprecated = true;
    if (type === "block") {
      if (repeat) attr.repeat = true;
      // Some documented arguments share a named block definition (password1/password2 -> password).
      const referenced = /`([a-z0-9_]+)`\s+(?:configuration\s+)?blocks?/.exec(b.text)?.[1];
      const nested = b.children.length ? b.children : depth < 16 && !seen.has(b.name) ? page.args.get(b.name) ?? (referenced ? page.args.get(referenced) : undefined) : undefined;
      if (nested?.length) {
        seen.add(b.name);
        attr.children = toAttrs(nested, page, seen, depth + 1);
        seen.delete(b.name);
      } else attr.children = [];
    } else {
      const values = type === "string" ? valuesIn(b.text) : undefined;
      if (values) attr.options = values;
      const d = defaultIn(b.text);
      const coerced = coerce(type, d);
      if (d !== undefined) attr.placeholder = d.length > 60 ? `${d.slice(0, 57)}…` : d;
      if (attr.required && coerced !== undefined) attr.default = coerced;
      if (SENSITIVE.test(b.name) && !NOT_SENSITIVE.test(b.name)) attr.sensitive = true;
      if (/(^|_)(cidr|cidrs|address_prefix|address_prefixes|address_space|ip_cidr_range|cidr_block|cidr_blocks)$/.test(b.name)) attr.cidr = true;
    }
    out.push(attr);
  }
  // Required arguments first, then the rest in documentation order (the form follows this order).
  return [...out.filter((a) => a.required), ...out.filter((a) => !a.required)];
}


export function parseProviderDocumentation(text: string): AttrDef[] {
  const page = parse(text);
  const attributes = toAttrs(page.args.get('') ?? [], page, new Set(), 0);
  const timeouts = page.args.get('timeouts');
  if (timeouts?.length && !attributes.some(attribute => attribute.name === 'timeouts')) {
    attributes.push({ name: 'timeouts', type: 'block', description: 'Operation timeouts documented for this resource.', children: toAttrs(timeouts, page, new Set(['timeouts']), 0) });
  }
  return attributes;
}

/** A documented object/list section can be edited as JSON without inventing individual HCL paths. */
export function jsonControlledArgumentNames(text: string, attributes: readonly AttrDef[]): string[] {
  const page = parse(text);
  const names = new Set<string>();
  const seen = new Set<string>();
  const section = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const visit = (bullets: readonly Bullet[]) => {
      for (const bullet of bullets) { names.add(bullet.name); visit(bullet.children); section(bullet.name); }
    };
    visit(page.args.get(name) ?? []);
  };
  const visit = (fields: readonly AttrDef[]) => {
    for (const field of fields) { if (field.type === 'map' || field.type === 'list') section(field.name); visit(field.children ?? []); }
  };
  visit(attributes);
  return [...names];
}
