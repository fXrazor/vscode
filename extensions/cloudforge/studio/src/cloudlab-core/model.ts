// Canonical architecture model. Independent of the canvas renderer and the Terraform writer:
// the canvas edits it, the generator reads it, the importer rebuilds it.
import {
  findAttr,
  getDef,
  getModule,
  type AttrDef,
  type ModuleDef,
  type ProviderId,
  type ResourceDef,
} from "./catalog/index.ts";

export type Ref = { $ref: string; attr: string; inherited?: boolean };
export type Expr = { $expr: string };
export type Value =
  | string
  | number
  | boolean
  | null
  | Ref
  | Expr
  | Value[]
  | { [key: string]: Value };

/**
 * resource: real resource block. data: data block (looks up something that exists).
 * icon: drawn only, settings kept so "Add to code" restores it. module: module block.
 * shape: drawing that can group nodes without passing settings. text: a label.
 */
export type NodeKind = "resource" | "data" | "icon" | "module" | "shape" | "text";

export interface Lifecycle {
  prevent_destroy?: boolean;
  create_before_destroy?: boolean;
  ignore_changes?: string[];
}

export interface ArchNode {
  id: string;
  kind: NodeKind;
  /** Terraform resource type (kept for icon-only nodes so they can return to code). */
  type?: string;
  moduleId?: string;
  /** Terraform local name (the part after the type in the address). */
  name: string;
  /** Label drawn on the canvas. */
  label: string;
  icon?: string;
  parentId?: string;
  /** Position relative to the parent (or the canvas). */
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, Value>;
  /** Optional arguments switched on in the Sections builder. */
  optional: string[];
  file: string;
  alias?: string;
  /** Azure provider configuration frame; never emitted as a resource. */
  subscription?: { id: string; name: string };
  extra: {
    count?: string;
    for_each?: string;
    depends_on: string[];
    lifecycle: Lifecycle;
  };
  /** Exported attributes written to outputs.tf. */
  outputs: string[];
  /** Relationship lines hidden by the person while the reference stays in code. */
  hiddenRefs: string[];
  module?: { source: string; version: string; inputs: Record<string, Value> };
  color?: string;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tool: "terraform" | "opentofu";
  toolVersion: string;
  providerVersions: Partial<Record<ProviderId, string>>;
  awsRegion: string;
  googleProject: string;
  googleRegion: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  revision: number;
  /** The project (container) this design belongs to. */
  folderId?: string;
  /** Deployment stage the design is for (Development, Test, Production or a custom name). */
  environment?: string;
}

/** A project: a named container that holds designs. */
export interface ProjectFolder {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export const ENVIRONMENTS = ["Development", "Test", "Production"] as const;
export const DEFAULT_ENVIRONMENT = "Development";

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const isRef = (v: unknown): v is Ref =>
  !!v && typeof v === "object" && !Array.isArray(v) && "$ref" in v;
export const isExpr = (v: unknown): v is Expr =>
  !!v && typeof v === "object" && !Array.isArray(v) && "$expr" in v;

export const NODE_W = 112;
export const NODE_H = 92;
export const PAD = 24;
export const HEADER = 34;

export function emptyProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    description: "",
    createdAt: now,
    updatedAt: now,
    tool: "terraform",
    toolVersion: ">= 1.9.0",
    providerVersions: {},
    awsRegion: "eu-west-1",
    googleProject: "my-project-id",
    googleRegion: "europe-west1",
    nodes: [],
    edges: [],
    revision: 0,
  };
}

export const nodeById = (p: Project, id: string | undefined) =>
  id ? p.nodes.find((n) => n.id === id) : undefined;
export const defOf = (n: ArchNode | undefined) => getDef(n?.type);
export const moduleOf = (n: ArchNode | undefined): ModuleDef | undefined =>
  getModule(n?.moduleId);
export const isContainer = (n: ArchNode) =>
  n.kind === "shape" || (!!defOf(n)?.container && n.kind !== "text");
export const providerOf = (n: ArchNode): ProviderId | undefined =>
  n.subscription ? "azurerm" : defOf(n)?.provider ?? moduleOf(n)?.provider;
export function effectiveAlias(p: Project, n: ArchNode): string | undefined {
  return n.alias || (providerOf(n) === "azurerm" ? ancestors(p, n).find((a) => a.subscription)?.alias : undefined);
}
export const inCode = (n: ArchNode) =>
  n.kind === "resource" || n.kind === "data" || n.kind === "module";

/** Terraform address of a node, as other code refers to it. */
export function address(n: ArchNode) {
  if (n.kind === "module") return `module.${n.name}`;
  if (n.kind === "data") return `data.${n.type}.${n.name}`;
  return `${n.type}.${n.name}`;
}

export function children(p: Project, id: string | undefined) {
  return p.nodes.filter((n) => n.parentId === id);
}

export function descendants(p: Project, id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const c of children(p, pid)) {
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

export function ancestors(p: Project, n: ArchNode): ArchNode[] {
  const out: ArchNode[] = [];
  let cur = nodeById(p, n.parentId);
  while (cur) {
    out.push(cur);
    cur = nodeById(p, cur.parentId);
  }
  return out;
}

export function absolute(p: Project, n: ArchNode) {
  let x = n.x;
  let y = n.y;
  for (const a of ancestors(p, n)) {
    x += a.x;
    y += a.y + 0;
  }
  return { x, y };
}

// ---------- Values at dotted paths (blocks are objects, repeated blocks arrays) ----------

export function getPath(config: Record<string, Value>, path: string): Value | undefined {
  let cur: Value | undefined = config;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!cur || typeof cur !== "object" || isRef(cur) || isExpr(cur)) return undefined;
    cur = (cur as Record<string, Value>)[part];
  }
  return cur;
}

export function setPath(
  config: Record<string, Value>,
  path: string,
  value: Value | undefined,
): Record<string, Value> {
  const [head, ...rest] = path.split(".");
  const next = { ...config };
  if (!head) return next;
  if (rest.length === 0) {
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  let inner = next[head];
  if (Array.isArray(inner)) {
    const first = (inner[0] as Record<string, Value>) ?? {};
    next[head] = [setPath(first, rest.join("."), value), ...inner.slice(1)];
    return next;
  }
  if (!inner || typeof inner !== "object" || isRef(inner) || isExpr(inner)) inner = {};
  next[head] = setPath(inner as Record<string, Value>, rest.join("."), value);
  return next;
}

// ---------- Creating nodes ----------

function defaultsFor(attrs: AttrDef[], requiredOnly: boolean): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const a of attrs) {
    if (requiredOnly && !a.required) continue;
    if (a.type === "block") {
      const inner = defaultsFor(a.children ?? [], false);
      out[a.name] = a.repeat ? [inner] : inner;
    } else if (a.default !== undefined) {
      const d = a.default;
      out[a.name] =
        typeof d === "string" && d.startsWith("${") && d.endsWith("}")
          ? { $expr: d.slice(2, -1) }
          : (structuredClone(d) as Value);
    }
  }
  return out;
}

const shortName = (type: string) =>
  type.replace(/^(azurerm|aws|google|kubernetes)_/, "");

export function uniqueName(p: Project, base: string, type?: string, except?: string) {
  const taken = new Set(
    p.nodes
      .filter((n) => n.id !== except && (type ? n.type === type : true))
      .map((n) => n.name),
  );
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function createResourceNode(
  p: Project,
  def: ResourceDef,
  x: number,
  y: number,
): ArchNode {
  const base = shortName(def.type);
  const name = uniqueName(p, base, def.type);
  const config = defaultsFor(def.attributes, true);
  const optional: string[] = [];
  for (const a of def.attributes) {
    if (!a.required && a.default !== undefined) {
      optional.push(a.name);
      Object.assign(config, defaultsFor([{ ...a, required: true }], true));
    }
  }
  const nameAttr = def.attributes.find(
    (a) => ["name", "bucket", "function_name", "identifier"].includes(a.name) && a.type === "string",
  );
  if (nameAttr) {
    const human = name.replaceAll("_", "-");
    if (nameAttr.required) config[nameAttr.name] = human;
    else {
      config[nameAttr.name] = human;
      optional.push(nameAttr.name);
    }
  }
  return {
    id: uid(),
    kind: "resource",
    type: def.type,
    name,
    label: def.displayName,
    icon: def.icon,
    x,
    y,
    w: def.container ? 380 : NODE_W,
    h: def.container ? 240 : NODE_H,
    config,
    optional,
    file: ["Networking", "Network", "Security", "Security & Identity"].includes(def.category) ? "network.tf" : "main.tf",
    extra: { depends_on: [], lifecycle: {} },
    outputs: [],
    hiddenRefs: [],
  };
}

export function createModuleNode(p: Project, mod: ModuleDef, x: number, y: number): ArchNode {
  const base = mod.id === "custom" ? "custom" : (mod.source.split("/")[1] ?? "module").replaceAll("-", "_");
  const inputs: Record<string, Value> = {};
  for (const i of mod.inputs) if (i.default !== undefined) inputs[i.name] = structuredClone(i.default) as Value;
  return {
    id: uid(),
    kind: "module",
    moduleId: mod.id,
    name: uniqueName(p, base),
    label: mod.displayName,
    icon: mod.icon,
    x,
    y,
    w: NODE_W,
    h: NODE_H,
    config: {},
    optional: [],
    file: "main.tf",
    extra: { depends_on: [], lifecycle: {} },
    outputs: [],
    hiddenRefs: [],
    module: { source: mod.source, version: mod.version, inputs },
  };
}

export function createShapeNode(kind: "shape" | "text", x: number, y: number, icon?: string): ArchNode {
  const iconOnly = !!icon;
  return {
    id: uid(),
    kind: iconOnly ? "icon" : kind,
    name: kind,
    label: kind === "text" ? "Text" : iconOnly ? (icon.split("/").pop() ?? "Icon").replace(/\.svg$/, "").replace(/^(aws|azure|gcp)-/, "").replaceAll("-", " ") : "Group",
    icon,
    x,
    y,
    w: kind === "shape" ? 320 : iconOnly ? NODE_W : 160,
    h: kind === "shape" ? 200 : iconOnly ? NODE_H : 36,
    config: {},
    optional: [],
    file: "main.tf",
    extra: { depends_on: [], lifecycle: {} },
    outputs: [],
    hiddenRefs: [],
    color: "#7aa2c8",
  };
}

// ---------- Placement rules ----------

export type Placement =
  | { ok: true; parentId: string | undefined }
  | { ok: false; reason: string }
  | { ok: "swap"; reason: string };

/** May `child` sit inside `parent`? Mirrors what the cloud provider allows. */
export function canPlace(p: Project, child: ArchNode, parent: ArchNode | undefined): Placement {
  if (!parent) return { ok: true, parentId: undefined };
  if (parent.id === child.id || descendants(p, child.id).includes(parent.id))
    return { ok: false, reason: "A node can't be placed inside itself." };
  const subscription = [parent, ...ancestors(p, parent)].find((n) => n.subscription);
  if (subscription && [child, ...descendants(p, child.id).map((id) => nodeById(p, id)!)].some((n) => !!n.subscription || !!providerOf(n) && providerOf(n) !== "azurerm"))
    return { ok: false, reason: "A subscription frame holds Azure resources and groups, not other providers or subscriptions." };
  if (parent.kind === "shape") {
    return { ok: true, parentId: parent.id };
  }
  if (!isContainer(parent)) return { ok: false, reason: `${parent.label} can't hold other nodes.` };
  if (child.kind === "shape" || child.kind === "text" || (child.kind === "icon" && !child.type))
    return { ok: true, parentId: parent.id };
  const cp = providerOf(child);
  const pp = providerOf(parent);
  if (cp && pp && cp !== pp)
    return {
      ok: false,
      reason: `${providerLabel(cp)} and ${providerLabel(pp)} nodes can't be nested: settings never pass between cloud providers.`,
    };
  const cdef = defOf(child);
  const pdef = defOf(parent);
  if (child.kind === "module") return { ok: true, parentId: parent.id };
  if (!cdef || !pdef) return { ok: true, parentId: parent.id };
  if (cdef.parents.includes(pdef.type)) return { ok: true, parentId: parent.id };
  if (cdef.type === pdef.type) return { ok: false, reason: `A ${cdef.displayName.toLowerCase()} can't be placed inside another ${cdef.displayName.toLowerCase()}.` };
  // Inside a deeper container than needed (e.g. a NSG dropped in a subnet): place it in the
  // nearest ancestor that accepts it.
  for (const a of ancestors(p, parent)) {
    const adef = defOf(a);
    if (adef && cdef.parents.includes(adef.type)) return { ok: true, parentId: a.id };
  }
  if (pdef.parents.includes(cdef.type))
    return {
      ok: "swap",
      reason: `${pdef.displayName} belongs inside ${cdef.displayName}, so they were put the right way round.`,
    };
  return {
    ok: false,
    reason: `${cdef.displayName} can't be placed inside ${pdef.displayName}${
      cdef.parents.length ? `; it belongs in ${cdef.parents.map((t) => getDef(t)?.displayName ?? t).join(" or ")}` : "; it sits at the top level"
    }.`,
  };
}

const providerLabel = (id: ProviderId) =>
  ({ azurerm: "Azure", aws: "AWS", google: "Google Cloud", kubernetes: "Kubernetes" })[id];

/** Re-apply container inheritance for one node (and everything below it). */
export function applyInheritance(p: Project, nodeId: string): Project {
  const ids = [nodeId, ...descendants(p, nodeId)];
  const nodes = p.nodes.map((n) => {
    if (!ids.includes(n.id)) return n;
    const def = defOf(n);
    if (!def || !inCode(n)) return n;
    let config = n.config;
    const ancs = ancestors(p, n).filter((a) => providerOf(a) === def.provider && a.kind !== "icon");
    for (const rule of def.inherit) {
      const from = ancs.find((a) => a.type === rule.fromType);
      const current = getPath(config, rule.attr);
      if (from) config = setPath(config, rule.attr, { $ref: from.id, attr: rule.fromAttr, inherited: true });
      else if (isRef(current) && current.inherited) config = setPath(config, rule.attr, undefined);
    }
    return config === n.config ? n : { ...n, config };
  });
  return { ...p, nodes };
}

/** Grow containers so they never end up smaller than what they hold. */
export function fitContainers(p: Project): Project {
  let nodes = p.nodes;
  // Deepest first so growth propagates upwards.
  const depth = (n: ArchNode) => ancestors({ ...p, nodes }, n).length;
  const order = [...nodes].filter((n) => isContainer(n)).sort((a, b) => depth(b) - depth(a));
  for (const c of order) {
    const kids = nodes.filter((n) => n.parentId === c.id);
    if (!kids.length) continue;
    let shiftX = 0;
    let shiftY = 0;
    const minX = Math.min(...kids.map((k) => k.x));
    const minY = Math.min(...kids.map((k) => k.y));
    if (minX < PAD) shiftX = PAD - minX;
    if (minY < HEADER + 8) shiftY = HEADER + 8 - minY;
    const maxX = Math.max(...kids.map((k) => k.x + k.w)) + shiftX + PAD;
    const maxY = Math.max(...kids.map((k) => k.y + k.h)) + shiftY + PAD;
    const cur = nodes.find((n) => n.id === c.id)!;
    const w = Math.max(cur.w, maxX);
    const h = Math.max(cur.h, maxY);
    if (shiftX || shiftY || w !== cur.w || h !== cur.h) {
      nodes = nodes.map((n) => {
        if (n.id === c.id) return { ...n, w: w, h: h, x: n.x - shiftX, y: n.y - shiftY };
        if (n.parentId === c.id) return { ...n, x: n.x + shiftX, y: n.y + shiftY };
        return n;
      });
    }
  }
  return { ...p, nodes };
}

export function minContainerSize(p: Project, c: ArchNode) {
  const kids = children(p, c.id);
  if (!kids.length) return { w: 160, h: 90 };
  return {
    w: Math.max(...kids.map((k) => k.x + k.w)) + PAD,
    h: Math.max(...kids.map((k) => k.y + k.h)) + PAD,
  };
}

/** Move `id` under `parentId`, keeping its position on screen. */
export function reparent(p: Project, id: string, parentId: string | undefined, absX: number, absY: number): Project {
  const parent = nodeById(p, parentId);
  const base = parent ? absolute(p, parent) : { x: 0, y: 0 };
  let next: Project = {
    ...p,
    nodes: p.nodes.map((n) => (n.id === id ? { ...n, parentId, x: absX - base.x, y: absY - base.y } : n)),
  };
  next = applyInheritance(next, id);
  return fitContainers(next);
}

/**
 * The dropped container belongs *around* the node it was dropped on (a VPC dropped on a subnet):
 * the new node takes the target's place and the target moves inside it.
 */
export function swapInto(p: Project, outerId: string, innerId: string): Project {
  const inner = nodeById(p, innerId);
  const outer = nodeById(p, outerId);
  if (!inner || !outer) return p;
  let next: Project = {
    ...p,
    nodes: p.nodes.map((n) => {
      if (n.id === outerId) return { ...n, parentId: inner.parentId, x: inner.x, y: inner.y, w: Math.max(n.w, inner.w + PAD * 2), h: Math.max(n.h, inner.h + HEADER + PAD * 2) };
      if (n.id === innerId) return { ...n, parentId: outerId, x: PAD, y: HEADER + 8 };
      return n;
    }),
  };
  next = applyInheritance(next, outerId);
  return fitContainers(next);
}

// ---------- References and lines ----------

export interface RefUse {
  nodeId: string;
  path: string;
  ref: Ref;
}

export function collectRefs(n: ArchNode): RefUse[] {
  const out: RefUse[] = [];
  const walk = (v: Value | undefined, path: string) => {
    if (v === undefined || v === null) return;
    if (isRef(v)) out.push({ nodeId: n.id, path, ref: v });
    else if (Array.isArray(v)) v.forEach((x) => walk(x, path));
    else if (typeof v === "object" && !isExpr(v))
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(n.config, "");
  if (n.module) walk(n.module.inputs, "");
  return out;
}

export type Line =
  | { kind: "relationship"; id: string; from: string; to: string; label: string; path: string }
  | { kind: "depends_on"; id: string; from: string; to: string; label: string }
  | { kind: "visual"; id: string; from: string; to: string; label: string };

export function lines(p: Project): Line[] {
  const out: Line[] = [];
  for (const n of p.nodes) {
    for (const r of collectRefs(n)) {
      if (r.ref.inherited || n.hiddenRefs.includes(r.path)) continue;
      if (!nodeById(p, r.ref.$ref)) continue;
      out.push({ kind: "relationship", id: `rel:${n.id}:${r.path}:${r.ref.$ref}`, from: r.ref.$ref, to: n.id, label: r.path.split(".").pop() ?? r.path, path: r.path });
    }
    for (const d of n.extra.depends_on)
      if (nodeById(p, d)) out.push({ kind: "depends_on", id: `dep:${n.id}:${d}`, from: d, to: n.id, label: "depends_on" });
  }
  for (const e of p.edges) out.push({ kind: "visual", id: e.id, from: e.from, to: e.to, label: e.label ?? "" });
  return out;
}

/** Arguments of `target` that can point at `source`. */
export function refCandidates(source: ArchNode, target: ArchNode): { path: string; attr: AttrDef }[] {
  const sdef = defOf(source);
  const tdef = defOf(target);
  if (!sdef || !tdef || !inCode(source) || !inCode(target)) return [];
  if (sdef.provider !== tdef.provider) return [];
  const out: { path: string; attr: AttrDef }[] = [];
  const walk = (list: AttrDef[], prefix: string) => {
    for (const a of list) {
      const path = prefix + a.name;
      if (a.children) walk(a.children, `${path}.`);
      else if (a.refTypes?.includes(sdef.type)) out.push({ path, attr: a });
    }
  };
  walk(tdef.attributes, "");
  return out;
}

/** Point `target.path` at `source` (lists get the reference appended). */
export function linkReference(p: Project, sourceId: string, targetId: string, path: string): Project {
  const target = nodeById(p, targetId);
  const def = defOf(target);
  if (!target || !def) return p;
  const attr = findAttr(def, path);
  const ref: Ref = { $ref: sourceId, attr: attr?.refAttr ?? "id" };
  const current = getPath(target.config, path);
  let value: Value = ref;
  if (attr?.type === "list") {
    const list = Array.isArray(current) ? current.filter((v) => !(isRef(v) && v.$ref === sourceId)) : [];
    value = [...list, ref];
  }
  const top = path.split(".")[0]!;
  return {
    ...p,
    nodes: p.nodes.map((n) =>
      n.id === targetId
        ? {
            ...n,
            config: setPath(n.config, path, value),
            optional: def.attributes.find((a) => a.name === top)?.required || n.optional.includes(top) ? n.optional : [...n.optional, top],
            hiddenRefs: n.hiddenRefs.filter((h) => h !== path),
          }
        : n,
    ),
  };
}

/** Remove the reference behind a relationship line (or keep it and only hide the line). */
export function unlinkReference(p: Project, line: Extract<Line, { kind: "relationship" }>, keepInCode: boolean): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      if (n.id !== line.to) return n;
      if (keepInCode) return { ...n, hiddenRefs: [...n.hiddenRefs, line.path] };
      const current = getPath(n.config, line.path);
      const next = Array.isArray(current)
        ? current.filter((v) => !(isRef(v) && v.$ref === line.from))
        : undefined;
      return { ...n, config: setPath(n.config, line.path, next && next.length ? next : undefined) };
    }),
  };
}

// ---------- Removing, renaming, copying ----------

function stripRefs(v: Value, removed: Set<string>): Value | undefined {
  if (isRef(v)) return removed.has(v.$ref) ? undefined : v;
  if (Array.isArray(v)) {
    const list = v.map((x) => stripRefs(x, removed)).filter((x): x is Value => x !== undefined);
    return list;
  }
  if (v && typeof v === "object" && !isExpr(v)) {
    const out: Record<string, Value> = {};
    for (const [k, x] of Object.entries(v)) {
      const s = stripRefs(x, removed);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return v;
}

export function removeNodes(p: Project, ids: string[]): Project {
  const removed = new Set(ids.flatMap((id) => [id, ...descendants(p, id)]));
  return {
    ...p,
    nodes: p.nodes
      .filter((n) => !removed.has(n.id))
      .map((n) => ({
        ...n,
        config: stripRefs(n.config, removed) as Record<string, Value>,
        module: n.module ? { ...n.module, inputs: stripRefs(n.module.inputs, removed) as Record<string, Value> } : undefined,
        extra: { ...n.extra, depends_on: n.extra.depends_on.filter((d) => !removed.has(d)) },
      })),
    edges: p.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to)),
  };
}

export const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function renameError(p: Project, n: ArchNode, name: string): string | undefined {
  if (!NAME_RE.test(name)) return "Use letters, digits, _ or -, starting with a letter or _.";
  const clash = p.nodes.find(
    (o) => o.id !== n.id && o.name === name && inCode(o) && o.kind === n.kind && o.type === n.type && o.moduleId === undefined === (n.moduleId === undefined),
  );
  if (clash && inCode(n)) return `${address({ ...n, name })} already exists.`;
  return undefined;
}

function rewire(v: Value, map: Map<string, string>): Value {
  if (isRef(v)) return map.has(v.$ref) ? { ...v, $ref: map.get(v.$ref)! } : v;
  if (Array.isArray(v)) return v.map((x) => rewire(x, map));
  if (v && typeof v === "object" && !isExpr(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewire(x, map)]));
  return v;
}

export interface Clip {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export function copySelection(p: Project, ids: string[]): Clip {
  const all = new Set(ids.flatMap((id) => [id, ...descendants(p, id)]));
  return {
    nodes: p.nodes.filter((n) => all.has(n.id)).map((n) => structuredClone(n)),
    edges: p.edges.filter((e) => all.has(e.from) && all.has(e.to)).map((e) => ({ ...e })),
  };
}

/** Paste with fresh ids and unique names; references inside the copied set are rewired. */
export function paste(p: Project, clip: Clip, offset = 40): { project: Project; ids: string[] } {
  const map = new Map(clip.nodes.map((n) => [n.id, uid()]));
  let next = p;
  const added: ArchNode[] = [];
  for (const n of clip.nodes) {
    const temp = { ...next, nodes: [...next.nodes, ...added] };
    const inside = n.parentId && map.has(n.parentId);
    const copy: ArchNode = {
      ...structuredClone(n),
      id: map.get(n.id)!,
      parentId: inside ? map.get(n.parentId!) : n.parentId,
      x: inside ? n.x : n.x + offset,
      y: inside ? n.y : n.y + offset,
      name: inCode(n) ? uniqueName(temp, n.name.replace(/_\d+$/, ""), n.type) : n.name,
      config: rewire(n.config, map) as Record<string, Value>,
      module: n.module ? { ...n.module, inputs: rewire(n.module.inputs, map) as Record<string, Value> } : undefined,
      extra: { ...n.extra, depends_on: n.extra.depends_on.map((d) => map.get(d) ?? d) },
    };
    // Unique human names for the cloud-side "name" too.
    const nameVal = copy.config.name;
    if (typeof nameVal === "string") copy.config = { ...copy.config, name: copy.name.replaceAll("_", "-") };
    added.push(copy);
  }
  next = {
    ...next,
    nodes: [...next.nodes, ...added],
    edges: [...next.edges, ...clip.edges.map((e) => ({ ...e, id: uid(), from: map.get(e.from)!, to: map.get(e.to)! }))],
  };
  for (const a of added) if (!a.parentId || !map.has(a.parentId)) next = applyInheritance(next, a.id);
  return { project: fitContainers(next), ids: added.filter((a) => !a.parentId || !map.has(a.parentId)).map((a) => a.id) };
}

/** Switch resource ↔ data source ↔ icon only. Settings are kept so the switch can be undone. */
export function setKind(p: Project, id: string, kind: "resource" | "data" | "icon"): Project {
  return { ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, kind } : n)) };
}

export function updateNode(p: Project, id: string, patch: Partial<ArchNode>): Project {
  return { ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}
