// Architecture model → Terraform/OpenTofu project files, and Terraform files → architecture model.
import { findAttr, getDef, getModule, providers, type AttrDef, type ProviderId, type ResourceDef } from "./catalog/index.ts";
import { alignBlock, blockToConfig, key, parseHcl, quote, type HclBlock } from "./hcl.ts";
import {
  address,
  applyInheritance,
  collectRefs,
  createModuleNode,
  DEFAULT_ENVIRONMENT,
  defOf,
  emptyProject,
  ENVIRONMENTS,
  effectiveAlias,
  fitContainers,
  getPath,
  HEADER,
  inCode,
  isContainer,
  isExpr,
  isRef,
  NODE_H,
  NODE_W,
  nodeById,
  PAD,
  providerOf,
  uid,
  type ArchNode,
  type Project,
  type Ref,
  type Value,
} from "./model.ts";

export type Files = Record<string, string>;

interface Ctx {
  p: Project;
  variables: Map<string, { type: string; description: string; sensitive?: boolean; default?: string }>;
  warnings: string[];
  usesClientConfig: boolean;
}

function refText(ctx: Ctx, r: Ref): string {
  const target = nodeById(ctx.p, r.$ref);
  if (!target) {
    ctx.warnings.push("A reference points at a node that no longer exists; it was written as null.");
    return "null";
  }
  if (!inCode(target)) {
    ctx.warnings.push(`${target.label} is icon-only, so a reference to it was written as null.`);
    return "null";
  }
  return `${address(target)}.${r.attr}`;
}

function scalar(ctx: Ctx, v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return quote(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isRef(v)) return refText(ctx, v);
  if (isExpr(v)) {
    if (v.$expr.includes("data.azurerm_client_config.current")) ctx.usesClientConfig = true;
    return v.$expr;
  }
  return "null";
}

function valueText(ctx: Ctx, v: Value, indent: string): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const parts = v.map((x) => valueText(ctx, x, indent + "  "));
    const one = `[${parts.join(", ")}]`;
    if (one.length <= 80 && !one.includes("\n")) return one;
    return `[\n${parts.map((x) => `${indent}  ${x},`).join("\n")}\n${indent}]`;
  }
  if (v && typeof v === "object" && !isRef(v) && !isExpr(v)) {
    const entries = Object.entries(v);
    if (!entries.length) return "{}";
    const width = Math.max(...entries.map(([k]) => key(k).length));
    return `{\n${entries.map(([k, x]) => `${indent}  ${key(k).padEnd(width)} = ${valueText(ctx, x, indent + "  ")}`).join("\n")}\n${indent}}`;
  }
  return scalar(ctx, v);
}

const isPlainObject = (v: unknown): v is Record<string, Value> =>
  !!v && typeof v === "object" && !Array.isArray(v) && !isRef(v) && !isExpr(v);

/** Body lines for a config, using the catalogue to tell blocks from maps. */
function bodyLines(ctx: Ctx, node: ArchNode, config: Record<string, Value>, attrs: AttrDef[] | undefined, indent: string, path: string, topLevel: boolean): string[] {
  const out: string[] = [];
  const blocks: string[] = [];
  const known = new Map((attrs ?? []).map((a) => [a.name, a]));
  const ordered = [
    ...(attrs ?? []).map((a) => a.name).filter((n) => n in config),
    ...Object.keys(config).filter((k) => !known.has(k)),
  ];
  for (const name of ordered) {
    const v = config[name];
    if (v === undefined) continue;
    const def = known.get(name);
    if (topLevel && def && !def.required && !node.optional.includes(name)) continue;
    const full = path ? `${path}.${name}` : name;
    const isBlock = def ? def.type === "block" : (isPlainObject(v) && name !== "tags" && name !== "labels") || (Array.isArray(v) && v.length > 0 && v.every(isPlainObject));
    if (isBlock) {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        if (!isPlainObject(item)) continue;
        blocks.push("");
        blocks.push(`${indent}${name} {`);
        blocks.push(...bodyLines(ctx, node, item, def?.children, indent + "  ", full, false));
        blocks.push(`${indent}}`);
      }
      continue;
    }
    if (def?.sensitive && typeof v === "string") {
      const varName = `${node.name}_${name}`;
      ctx.variables.set(varName, { type: "string", description: `${def.description} (sensitive: never stored in code)`, sensitive: true });
      out.push(`${indent}${name} = var.${varName}`);
      continue;
    }
    if (v === "" && !def?.required) continue;
    out.push(`${indent}${key(name)} = ${valueText(ctx, v, indent)}`);
  }
  if (blocks.length && blocks[0] === "" && out.length === 0) blocks.shift();
  return [...out, ...blocks];
}

function metaLines(ctx: Ctx, n: ArchNode): { head: string[]; tail: string[] } {
  const head: string[] = [];
  const tail: string[] = [];
  if (n.extra.count) head.push(`  count = ${n.extra.count}`);
  else if (n.extra.for_each) head.push(`  for_each = ${n.extra.for_each}`);
  const prov = providerOf(n);
  const alias = effectiveAlias(ctx.p, n);
  if (alias && prov) head.push(n.kind === "module" ? `  providers = { ${prov} = ${prov}.${alias} }` : `  provider = ${prov}.${alias}`);
  if (head.length) head.push("");
  const deps = n.extra.depends_on.map((d) => nodeById(ctx.p, d)).filter((d): d is ArchNode => !!d && inCode(d));
  if (deps.length) tail.push("", `  depends_on = [${deps.map(address).join(", ")}]`);
  const lc = n.extra.lifecycle;
  if (n.kind === "resource" && (lc.prevent_destroy || lc.create_before_destroy || lc.ignore_changes?.length)) {
    tail.push("", "  lifecycle {");
    if (lc.prevent_destroy) tail.push("    prevent_destroy = true");
    if (lc.create_before_destroy) tail.push("    create_before_destroy = true");
    if (lc.ignore_changes?.length) tail.push(`    ignore_changes = [${lc.ignore_changes.join(", ")}]`);
    tail.push("  }");
  }
  return { head, tail };
}

/** The HCL block for one node (used by the generator and the per-resource code view). */
export function nodeBlock(p: Project, n: ArchNode, ctx?: Ctx): string {
  const c: Ctx = ctx ?? { p, variables: new Map(), warnings: [], usesClientConfig: false };
  const def = defOf(n);
  const lines: string[] = [];
  const parent = nodeById(p, n.parentId);
  const comment = [`# ${n.label}`, def ? ` (${def.displayName})` : "", parent ? ` inside ${parent.label}` : ""].join("");
  lines.push(comment);
  const { head, tail } = metaLines(c, n);
  if (n.kind === "module") {
    const mod = getModule(n.moduleId);
    lines.push(`module "${n.name}" {`);
    lines.push(`  source = ${quote(n.module?.source ?? mod?.source ?? "")}`);
    const src = n.module?.source ?? "";
    const registry = !src.startsWith(".") && !src.startsWith("/") && !src.includes("::") && !src.startsWith("git");
    if (registry && n.module?.version) lines.push(`  version = ${quote(n.module.version)}`);
    lines.push("", ...head.filter(Boolean));
    for (const [k, v] of Object.entries(n.module?.inputs ?? {})) lines.push(`  ${key(k)} = ${valueText(c, v, "  ")}`);
    lines.push(...tail, "}");
    return alignBlock(lines.filter((l, i, a) => !(l === "" && a[i - 1] === ""))).join("\n");
  }
  if (!n.type) return "";
  if (n.kind === "data") {
    lines.push(`data "${n.type}" "${n.name}" {`, ...head);
    const keep = def?.dataArgs ?? Object.keys(n.config);
    const cfg: Record<string, Value> = {};
    for (const k of keep) {
      const v = getPath(n.config, k);
      if (v !== undefined) cfg[k] = v;
    }
    lines.push(...bodyLines(c, { ...n, optional: keep }, cfg, def?.attributes, "  ", "", false));
  } else {
    lines.push(`resource "${n.type}" "${n.name}" {`, ...head);
    lines.push(...bodyLines(c, n, n.config, def?.attributes, "  ", "", true));
  }
  lines.push(...tail, "}");
  return alignBlock(lines.filter((l, i, a) => !(l === "" && (a[i - 1] === "" || a[i - 1]?.endsWith("{"))))).join("\n");
}

export function usedProviders(p: Project): ProviderId[] {
  const set = new Set<ProviderId>();
  for (const n of p.nodes) {
    if (!inCode(n) && !n.subscription) continue;
    const prov = providerOf(n);
    if (prov && (n.kind !== "module" || n.moduleId !== "custom")) set.add(prov);
  }
  return [...set].sort();
}

export const constraintFor = (p: Project, id: ProviderId) =>
  p.providerVersions[id] ?? providers[id].defaultConstraint;

export interface Generated {
  files: Files;
  warnings: string[];
}

export function generate(p: Project): Generated {
  const ctx: Ctx = { p, variables: new Map(), warnings: [], usesClientConfig: false };
  const files: Files = {};
  const byFile = new Map<string, string[]>();
  // Containers first, then by position, so the code reads top-down like the diagram.
  const ordered = [...p.nodes].filter(inCode).sort((a, b) => depth(p, a) - depth(p, b) || a.y - b.y || a.x - b.x);
  for (const n of ordered) {
    const block = nodeBlock(p, n, ctx);
    if (!block) continue;
    const file = n.file || "main.tf";
    byFile.set(file, [...(byFile.get(file) ?? []), block]);
  }
  const used = usedProviders(p);
  const aliases = new Map<ProviderId, Set<string>>();
  for (const n of p.nodes) {
    const prov = providerOf(n);
    const alias = effectiveAlias(p, n);
    if (alias && prov && (inCode(n) || n.subscription)) aliases.set(prov, new Set([...(aliases.get(prov) ?? []), alias]));
  }

  // versions.tf
  const req = used.map((id) => `    ${id} = {\n      source  = "${providers[id].source}"\n      version = "${constraintFor(p, id)}"\n    }`);
  files["versions.tf"] = [
    `# ${p.tool === "opentofu" ? "OpenTofu" : "Terraform"} and provider versions chosen for this project.`,
    "terraform {",
    `  required_version = "${p.toolVersion}"`,
    ...(req.length ? ["", "  required_providers {", req.join("\n"), "  }"] : []),
    "}",
    "",
  ].join("\n");

  // providers.tf
  const prov: string[] = ["# Provider settings. Credentials come from your own environment, never from these files.", ""];
  if (used.includes("aws")) {
    ctx.variables.set("aws_region", { type: "string", description: "AWS region to deploy to.", default: quote(p.awsRegion) });
  }
  if (used.includes("google")) {
    ctx.variables.set("google_project", { type: "string", description: "Google Cloud project id.", default: quote(p.googleProject) });
    ctx.variables.set("google_region", { type: "string", description: "Google Cloud region.", default: quote(p.googleRegion) });
  }
  const providerBody = (id: ProviderId, alias?: string) => {
    const lines = [`provider "${id}" {`];
    if (alias) lines.push(`  alias = "${alias}"`);
    if (id === "azurerm") {
      const subscription = alias ? p.nodes.find((n) => n.subscription && n.alias === alias)?.subscription : undefined;
      if (subscription?.id) lines.push(`  subscription_id = ${quote(subscription.id)}`);
      // The default provider takes the subscription from terraform.tfvars, or from ARM_SUBSCRIPTION_ID when left empty.
      else if (!alias) lines.push('  subscription_id = var.azure_subscription_id != "" ? var.azure_subscription_id : null');
      lines.push("  features {}");
    }
    if (id === "aws") lines.push("  region = var.aws_region");
    if (id === "google") lines.push("  project = var.google_project", "  region  = var.google_region");
    if (id === "kubernetes") lines.push('  config_path = "~/.kube/config"');
    lines.push("}", "");
    return alignBlock(lines).join("\n");
  };
  for (const id of used) {
    prov.push(providerBody(id));
    for (const a of aliases.get(id) ?? []) prov.push(providerBody(id, a));
  }
  if (used.length) files["providers.tf"] = prov.join("\n");

  for (const [file, blocks] of byFile) {
    let text = blocks.join("\n\n") + "\n";
    if (file === "main.tf" && ctx.usesClientConfig) text = `data "azurerm_client_config" "current" {}\n\n${text}`;
    files[file] = text;
  }
  if (ctx.usesClientConfig && !byFile.has("main.tf")) files["main.tf"] = 'data "azurerm_client_config" "current" {}\n';

  // variables.tf: the project's own inputs first, then what resources needed (sensitive values, regions).
  const environment = (p.environment ?? DEFAULT_ENVIRONMENT).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "development";
  const own = new Map<string, { type: string; description: string; sensitive?: boolean; default?: string }>([
    ["project_name", { type: "string", description: "Short name of this project, used in tags and labels.", default: quote(p.name) }],
    ["environment", { type: "string", description: "Deployment stage this configuration is for (development, test, production).", default: quote(environment) }],
  ]);
  if (used.includes("azurerm")) {
    const locations = p.nodes.filter((n) => inCode(n) && providerOf(n) === "azurerm").map((n) => n.config.location).filter((v): v is string => typeof v === "string" && !!v);
    const common = [...locations.sort()].sort((a, b) => locations.filter((x) => x === b).length - locations.filter((x) => x === a).length)[0] ?? "westeurope";
    own.set("azure_location", { type: "string", description: "Default Azure region for new resources.", default: quote(common) });
    own.set("azure_subscription_id", { type: "string", description: "Azure subscription to deploy to. Leave empty to use ARM_SUBSCRIPTION_ID from your environment.", default: '""' });
  }
  const variables = new Map([...own, ...[...ctx.variables].filter(([name]) => !own.has(name))]);
  files["variables.tf"] =
    "# Inputs of this project. Values come from terraform.tfvars (or environments/<stage>.tfvars); secrets are never written here.\n\n" +
    [...variables]
      .map(([name, v]) =>
        alignBlock([
          `variable "${name}" {`,
          `  description = ${quote(v.description)}`,
          `  type = ${v.type}`,
          ...(v.default !== undefined ? [`  default = ${v.default}`] : []),
          ...(v.sensitive ? ["  sensitive = true"] : []),
          "}",
        ]).join("\n"),
      )
      .join("\n\n") + "\n";
  const tfvars = (stage: string, header: string) => {
    const lines = alignBlock([...variables].map(([name, v]) => `${name} = ${name === "environment" ? quote(stage) : v.sensitive ? '""' : v.default ?? '""'}`));
    const secrets = [...variables].filter(([, v]) => v.sensitive).map(([name]) => name);
    return `${header}\n${secrets.length ? `# Fill in before applying (never commit real values): ${secrets.join(", ")}\n` : ""}\n${lines.join("\n")}\n`;
  };
  files["terraform.tfvars"] = tfvars(environment, `# Values for the "${environment}" stage of ${p.name}. Edit freely; this file is listed in .gitignore because it may hold secrets.`);
  files["terraform.tfvars.example"] = tfvars(environment, "# Copy to terraform.tfvars and fill in. Never commit real secrets.");
  for (const stage of ENVIRONMENTS.map((e) => e.toLowerCase())) {
    files[`environments/${stage}.tfvars`] = tfvars(stage, `# ${stage}: terraform plan -var-file=environments/${stage}.tfvars`);
  }

  // locals.tf: shared tags, ready to attach to resources (tags = local.common_tags).
  files["locals.tf"] = [
    "# Shared values. Attach the tags to resources with `tags = local.common_tags` (labels on Google Cloud).",
    "locals {",
    "  common_tags = {",
    "    project     = var.project_name",
    "    environment = var.environment",
    '    managed_by  = "terraform"',
    "  }",
    "}",
    "",
  ].join("\n");

  // backend.tf: state stays local until a remote backend is chosen; examples for each cloud.
  files["backend.tf"] = [
    "# Where Terraform keeps its state. Local by default; uncomment one remote backend for team use,",
    "# then run `terraform init -migrate-state`. Never commit terraform.tfstate.",
    "terraform {",
    '  backend "local" {',
    '    path = "terraform.tfstate"',
    "  }",
    "",
    ...(used.includes("azurerm") ? ['  # backend "azurerm" {', '  #   resource_group_name  = "rg-terraform-state"', '  #   storage_account_name = "sttfstate"', '  #   container_name       = "tfstate"', `  #   key                  = "${environment}.terraform.tfstate"`, "  # }", ""] : []),
    ...(used.includes("aws") ? ['  # backend "s3" {', '  #   bucket       = "my-terraform-state"', `  #   key          = "${environment}/terraform.tfstate"`, '  #   region       = "eu-west-1"', "  #   use_lockfile = true", "  # }", ""] : []),
    ...(used.includes("google") ? ['  # backend "gcs" {', '  #   bucket = "my-terraform-state"', `  #   prefix = "${environment}"`, "  # }", ""] : []),
    "}",
    "",
  ].join("\n");

  // outputs.tf: the outputs chosen in the designer, or the ids of the main resources until some are chosen.
  const outs: string[] = [];
  for (const n of ordered) for (const attr of n.outputs) {
    const sensitive = /key|password|secret|kube_config/.test(attr);
    outs.push(alignBlock([`output "${n.name}_${attr}" {`, `  value = ${address(n)}.${attr}`, ...(sensitive ? ["  sensitive = true"] : []), "}"]).join("\n"));
  }
  if (!outs.length) {
    const resources = ordered.filter((n) => n.kind === "resource" && !n.subscription);
    const main = resources.filter((n) => getDef(n.type)?.container);
    for (const n of (main.length ? main : resources).slice(0, 10)) {
      outs.push(alignBlock([`output "${n.name}_id" {`, `  description = ${quote(`Id of ${n.label}.`)}`, `  value = ${address(n)}.id`, "}"]).join("\n"));
    }
  }
  files["outputs.tf"] = (outs.length ? "# Values shown after apply. Choose outputs per resource in the designer (Outputs).\n\n" + outs.join("\n\n") : "# No resources yet: outputs appear here once the design has some.\n") + "\n";

  files[".gitignore"] = ".terraform/\n*.tfstate\n*.tfstate.*\n*.tfvars\n!*.tfvars.example\n!environments/*.tfvars\ncrash.log\n.terraform.lock.hcl.bak\n";
  files["README.md"] = readme(p, used, ctx);
  files["architecture/architecture.json"] = JSON.stringify(stripForExport(p), null, 2) + "\n";
  files["architecture/dependencies.json"] = JSON.stringify(dependencyList(p), null, 2) + "\n";
  return { files, warnings: [...new Set(ctx.warnings)] };
}

const depth = (p: Project, n: ArchNode) => {
  let d = 0;
  const seen = new Set<string>([n.id]);
  let cur = nodeById(p, n.parentId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    d++;
    cur = nodeById(p, cur.parentId);
  }
  return d;
};

function stripForExport(p: Project) {
  return { format: "cloudlab-forge/architecture@1", ...p };
}

export function dependencyList(p: Project) {
  const out: { from: string; to: string; kind: string; via?: string }[] = [];
  for (const n of p.nodes) {
    if (!inCode(n)) continue;
    const walk = (v: Value | undefined, path: string) => {
      if (v === undefined || v === null) return;
      if (isRef(v)) {
        const t = nodeById(p, v.$ref);
        if (t) out.push({ from: address(n), to: address(t), kind: v.inherited ? "container" : "reference", via: path });
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, path));
      else if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(n.config, "");
    for (const d of n.extra.depends_on) {
      const t = nodeById(p, d);
      if (t) out.push({ from: address(n), to: address(t), kind: "depends_on" });
    }
  }
  return out;
}

function readme(p: Project, used: ProviderId[], ctx: Ctx) {
  const rows = p.nodes.filter(inCode).map((n) => `| \`${address(n)}\` | ${n.label} | ${defOf(n)?.displayName ?? (n.kind === "module" ? "Module" : n.type)} | ${n.file} |`);
  const tool = p.tool === "opentofu" ? "tofu" : "terraform";
  return [
    `# ${p.name}`,
    "",
    p.description || "Infrastructure designed in CloudLab Forge.",
    "",
    "## What is here",
    "",
    "| Address | Label | Kind | File |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Providers",
    "",
    ...used.map((id) => `- \`${providers[id].source}\` ${constraintFor(p, id)} (catalogue checked against ${providers[id].verifiedAgainst})`),
    "",
    "## Deploy it yourself",
    "",
    "Nothing in this project deploys automatically. Sign in with your own cloud credentials, then:",
    "",
    "```sh",
    `${tool} init`,
    `${tool} fmt -check`,
    `${tool} validate`,
    `${tool} plan`,
    "```",
    "",
    "Review the plan before you run `apply`.",
    "",
    "## Inputs",
    "",
    "`variables.tf` declares the inputs; `terraform.tfvars` holds the values for this design's stage and `environments/<stage>.tfvars` the other stages:",
    "",
    "```sh",
    `${tool} plan -var-file=environments/production.tfvars`,
    "```",
    "",
    "`locals.tf` defines shared tags, `backend.tf` keeps state local until you choose a remote backend, and `outputs.tf` lists what is shown after apply.",
    "",
    "## Security notes",
    "",
    "- No credentials are written into these files; sensitive values are variables marked `sensitive`.",
    "- `architecture/architecture.json` reopens the diagram in CloudLab Forge.",
    "",
  ].join("\n");
}

// ---------------- Import: Terraform files → architecture ----------------

export interface ImportResult {
  project: Project;
  report: string[];
}

function repeatNamesOf(def: ResourceDef | undefined) {
  const out = new Set<string>();
  const walk = (list: AttrDef[]) => list.forEach((a) => {
    if (a.repeat) out.add(a.name);
    if (a.children) walk(a.children);
  });
  if (def) walk(def.attributes);
  return out;
}

/** Turn `type.name.attr` / `data.type.name.attr` / `module.name.out` expressions into references. */
function resolveRefs(v: Value, index: Map<string, string>): Value {
  if (isExpr(v)) {
    const m = /^((?:data\.)?[a-z0-9_]+\.[A-Za-z0-9_-]+|module\.[A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/.exec(v.$expr);
    if (m && index.has(m[1]!)) return { $ref: index.get(m[1]!)!, attr: m[2]! };
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, index));
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, index)]));
  return v;
}

interface Parsed {
  file: string;
  block: HclBlock;
}

/**
 * Rebuild an editable architecture from Terraform files. Nothing is executed.
 * `base` lets the code editor update an existing design in place (matching by address).
 */
export function importTerraform(files: Files, name: string, base?: Project): ImportResult {
  const report: string[] = [];
  const parsed: Parsed[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith(".tf")) continue;
    try {
      parsed.push(...parseHcl(text).blocks.map((block) => ({ file: file.split("/").pop() ?? file, block })));
    } catch (e) {
      report.push(`${file}: could not be read: ${(e as Error).message}`);
    }
  }
  let p: Project = base ? { ...base, nodes: [...base.nodes] } : emptyProject(name);
  const existing = new Map(p.nodes.filter(inCode).map((n) => [address(n), n]));
  const seen = new Set<string>();
  const index = new Map<string, string>();
  const created: ArchNode[] = [];
  const pending: { node: ArchNode; block: HclBlock }[] = [];

  for (const { file, block } of parsed) {
    if (block.type === "terraform") {
      for (const rp of block.blocks.filter((b) => b.type === "required_providers")) {
        for (const [prov, spec] of Object.entries(rp.attrs)) {
          const version = isPlainObject(spec) ? (spec as Record<string, Value>).version : undefined;
          if (typeof version === "string" && prov in providers)
            p.providerVersions = { ...p.providerVersions, [prov]: version };
        }
      }
      if (typeof block.attrs.required_version === "string") p.toolVersion = block.attrs.required_version;
      continue;
    }
    if (block.type === "resource" || block.type === "data") {
      const [type, local] = block.labels;
      if (!type || !local) continue;
      const def = getDef(type);
      const addr = block.type === "data" ? `data.${type}.${local}` : `${type}.${local}`;
      seen.add(addr);
      const config = blockToConfig(block, repeatNamesOf(def));
      const prior = existing.get(addr);
      const node: ArchNode = prior
        ? { ...prior, config, file }
        : {
            id: uid(),
            kind: block.type === "data" ? "data" : "resource",
            type,
            name: local,
            label: def?.displayName ?? type,
            icon: def?.icon,
            x: 0,
            y: 0,
            w: def?.container ? 380 : NODE_W,
            h: def?.container ? 240 : NODE_H,
            config,
            optional: [],
            file,
            extra: { depends_on: [], lifecycle: {} },
            outputs: [],
            hiddenRefs: [],
          };
      if (!def) report.push(`${addr}: not in the catalogue yet; kept as a generic resource with its arguments.`);
      if (def) node.optional = Object.keys(config).filter((k) => !findAttr(def, k)?.required);
      index.set(addr, node.id);
      pending.push({ node, block });
      if (!prior) created.push(node);
      else p.nodes = p.nodes.map((n) => (n.id === node.id ? node : n));
      if (block.blocks.some((b) => b.type === "dynamic")) report.push(`${addr}: dynamic blocks are not editable in the form and were left out.`);
      continue;
    }
    if (block.type === "module") {
      const [local] = block.labels;
      if (!local) continue;
      const addr = `module.${local}`;
      seen.add(addr);
      const { source, version, ...inputs } = block.attrs;
      const prior = existing.get(addr);
      const node: ArchNode = prior ?? createModuleNode(p, getModule("custom")!, 0, 0);
      node.name = local;
      node.file = file;
      node.label = typeof source === "string" ? source.split("/").slice(-2).join("/") : local;
      node.moduleId = typeof source === "string" ? (getModule(source)?.id ?? "custom") : "custom";
      node.module = { source: typeof source === "string" ? source : "", version: typeof version === "string" ? version : "", inputs: inputs as Record<string, Value> };
      index.set(addr, node.id);
      pending.push({ node, block });
      if (!prior) created.push(node);
      continue;
    }
    if (["provider", "variable", "output", "locals", "moved", "import", "check"].includes(block.type)) {
      if (block.type === "output" && isExpr(block.attrs.value)) {
        const m = /^(.*)\.([A-Za-z0-9_]+)$/.exec(block.attrs.value.$expr);
        if (m) pending.push({ node: { id: `out:${m[1]}`, outputAttr: m[2] } as unknown as ArchNode, block });
      }
      if (!["provider", "output"].includes(block.type)) report.push(`${file}: ${block.type} "${block.labels.join(".")}" is kept as an expression reference, not drawn.`);
      continue;
    }
    report.push(`${file}: ${block.type} blocks are not supported and were skipped.`);
  }

  p.nodes = [...p.nodes, ...created];
  // Resolve references now that every address is known.
  for (const n of p.nodes) if (inCode(n)) index.set(address(n), n.id);
  for (const { node, block } of pending) {
    const n = p.nodes.find((x) => x.id === node.id);
    if (!n) {
      const outAttr = (node as unknown as { outputAttr?: string }).outputAttr;
      const target = index.get(node.id.slice(4));
      if (outAttr && target) p.nodes = p.nodes.map((x) => (x.id === target && !x.outputs.includes(outAttr) ? { ...x, outputs: [...x.outputs, outAttr] } : x));
      continue;
    }
    const patch: Partial<ArchNode> = {};
    if (n.kind === "module" && n.module) patch.module = { ...n.module, inputs: resolveRefs(n.module.inputs, index) as Record<string, Value> };
    else patch.config = resolveRefs(n.config, index) as Record<string, Value>;
    const meta = block.attrs;
    patch.extra = { depends_on: [], lifecycle: {} };
    if (meta.count !== undefined) patch.extra.count = isExpr(meta.count) ? meta.count.$expr : String(meta.count);
    if (meta.for_each !== undefined) patch.extra.for_each = isExpr(meta.for_each) ? meta.for_each.$expr : JSON.stringify(meta.for_each);
    if (Array.isArray(meta.depends_on))
      patch.extra.depends_on = meta.depends_on.map((d) => (isExpr(d) ? index.get(d.$expr) : undefined)).filter((d): d is string => !!d);
    if (isExpr(meta.provider)) patch.alias = meta.provider.$expr.split(".")[1];
    const lc = block.blocks.find((b) => b.type === "lifecycle");
    if (lc) {
      patch.extra.lifecycle = {
        prevent_destroy: lc.attrs.prevent_destroy === true,
        create_before_destroy: lc.attrs.create_before_destroy === true,
        ignore_changes: Array.isArray(lc.attrs.ignore_changes) ? lc.attrs.ignore_changes.map((x) => (isExpr(x) ? x.$expr : String(x))) : undefined,
      };
    }
    for (const k of ["count", "for_each", "depends_on", "provider"]) if (patch.config) delete patch.config[k];
    if (patch.module) for (const k of ["count", "for_each", "depends_on", "providers"]) delete patch.module.inputs[k];
    p.nodes = p.nodes.map((x) => (x.id === n.id ? { ...x, ...patch } : x));
  }

  // Blocks removed from the code are removed from the diagram (only when editing a design).
  if (base) {
    const gone = base.nodes.filter((n) => inCode(n) && !seen.has(address(n))).map((n) => n.id);
    if (gone.length) report.push(`${gone.length} node(s) removed because their blocks are no longer in the code.`);
    p.nodes = p.nodes.filter((n) => !gone.includes(n.id));
  }

  // Containment from inherited references (subnet → its network, VM → its subnet...).
  for (const n of created) {
    const cur = p.nodes.find((x) => x.id === n.id)!;
    const def = defOf(cur);
    if (!def) continue;
    let parentId: string | undefined;
    for (const parentType of def.parents) {
      const rule = def.inherit.find((r) => r.fromType === parentType);
      const v = rule ? getPath(cur.config, rule.attr) : undefined;
      if (isRef(v) && nodeById(p, v.$ref)?.type === parentType) {
        parentId = v.$ref;
        break;
      }
    }
    // Fall back to a grandparent rule (e.g. NIC's subnet).
    if (!parentId)
      for (const rule of def.inherit) {
        const v = getPath(cur.config, rule.attr);
        if (isRef(v) && def.parents.includes(nodeById(p, v.$ref)?.type ?? "")) parentId = v.$ref;
      }
    if (parentId && !wouldCycle(p, cur.id, parentId)) p.nodes = p.nodes.map((x) => (x.id === cur.id ? { ...x, parentId } : x));
  }
  // Prefer a closer container reached through a reference (a VM goes in its network card's subnet).
  for (const n of created) {
    const cur = p.nodes.find((x) => x.id === n.id)!;
    const def = defOf(cur);
    if (!def || def.parents.length < 2) continue;
    const rank = (id: string | undefined) => {
      const i = def.parents.indexOf(nodeById(p, id)?.type ?? "");
      return i < 0 ? 99 : i;
    };
    let best = cur.parentId;
    for (const r of collectRefs(cur)) {
      const via = nodeById(p, r.ref.$ref);
      if (via?.parentId && rank(via.parentId) < rank(best) && !wouldCycle(p, cur.id, via.parentId)) best = via.parentId;
    }
    if (best !== cur.parentId) p.nodes = p.nodes.map((x) => (x.id === cur.id ? { ...x, parentId: best } : x));
  }
  for (const n of created) p = applyInheritance(p, n.id);
  p = layoutNew(p, new Set(created.map((c) => c.id)), base ? rightEdge(base) : 60);
  if (!base) report.unshift(`Imported ${created.length} block(s) from ${Object.keys(files).filter((f) => f.endsWith(".tf")).length} file(s).`);
  return { project: fitContainers(p), report };
}

function wouldCycle(p: Project, id: string, parentId: string) {
  let cur: string | undefined = parentId;
  while (cur) {
    if (cur === id) return true;
    cur = nodeById(p, cur)?.parentId;
  }
  return false;
}

function rightEdge(p: Project) {
  const tops = p.nodes.filter((n) => !n.parentId);
  return tops.length ? Math.max(...tops.map((n) => n.x + n.w)) + 80 : 60;
}

/** Simple nested grid layout for newly created nodes. */
function layoutNew(p: Project, fresh: Set<string>, startX: number): Project {
  const nodes = new Map(p.nodes.map((n) => [n.id, { ...n }]));
  const kids = (id: string | undefined) => [...nodes.values()].filter((n) => n.parentId === id && fresh.has(n.id));
  const place = (list: ArchNode[], originX: number, originY: number, perRow: number) => {
    let x = originX;
    let y = originY;
    let rowH = 0;
    let col = 0;
    let maxX = originX;
    for (const n of list) {
      if (isContainer(n)) {
        const inner = kids(n.id);
        const size = place(inner, PAD, HEADER + 12, 3);
        n.w = Math.max(n.w, size.w + PAD);
        n.h = Math.max(n.h, size.h + PAD);
      }
      if (col >= perRow) {
        col = 0;
        x = originX;
        y += rowH + 40;
        rowH = 0;
      }
      n.x = x;
      n.y = y;
      x += n.w + 40;
      maxX = Math.max(maxX, x);
      rowH = Math.max(rowH, n.h);
      col++;
    }
    return { w: maxX - 40, h: y + rowH };
  };
  place(kids(undefined), startX, 60, 4);
  for (const n of nodes.values()) if (n.parentId && !nodes.has(n.parentId)) n.parentId = undefined;
  // New children of existing containers.
  const orphans = [...nodes.values()].filter((n) => fresh.has(n.id) && n.parentId && !fresh.has(n.parentId));
  orphans.forEach((n, i) => {
    n.x = PAD + (i % 3) * (NODE_W + 24);
    n.y = HEADER + 12 + Math.floor(i / 3) * (NODE_H + 24);
  });
  return { ...p, nodes: p.nodes.map((n) => nodes.get(n.id)!) };
}

/** Apply edited code for one node (per-resource code view). */
export function applyNodeCode(p: Project, nodeId: string, code: string): { project: Project; error?: string } {
  const n = nodeById(p, nodeId);
  if (!n) return { project: p, error: "Node not found." };
  try {
    const file = parseHcl(code);
    const block = file.blocks[0];
    if (!block) return { project: p, error: "No block found." };
    const index = new Map(p.nodes.filter(inCode).map((x) => [address(x), x.id]));
    if (n.kind === "module") {
      const { source, version, ...inputs } = block.attrs;
      return {
        project: { ...p, nodes: p.nodes.map((x) => (x.id === nodeId ? { ...x, module: { source: String(source ?? ""), version: typeof version === "string" ? version : "", inputs: resolveRefs(inputs, index) as Record<string, Value> } } : x)) },
      };
    }
    const def = defOf(n);
    const config = resolveRefs(blockToConfig(block, repeatNamesOf(def)), index) as Record<string, Value>;
    // Keep inherited references when the code still points at the same container.
    const old = n.config;
    for (const rule of def?.inherit ?? []) {
      const before = getPath(old, rule.attr);
      const after = getPath(config, rule.attr);
      if (isRef(before) && before.inherited && isRef(after) && after.$ref === before.$ref) Object.assign(after, { inherited: true });
    }
    const meta = ["count", "for_each", "depends_on", "provider"];
    const extra = { ...n.extra };
    if (config.count !== undefined) extra.count = isExpr(config.count) ? config.count.$expr : String(config.count);
    else extra.count = undefined;
    if (Array.isArray(config.depends_on)) extra.depends_on = config.depends_on.map((d) => (isRef(d) ? d.$ref : isExpr(d) ? index.get(d.$expr) : undefined)).filter((d): d is string => !!d);
    else extra.depends_on = [];
    for (const m of meta) delete config[m];
    const optional = def ? Object.keys(config).filter((k) => !findAttr(def, k)?.required) : n.optional;
    const name = block.labels[block.type === "resource" || block.type === "data" ? 1 : 0] ?? n.name;
    return { project: { ...p, nodes: p.nodes.map((x) => (x.id === nodeId ? { ...x, config, optional, extra, name } : x)) } };
  } catch (e) {
    return { project: p, error: (e as Error).message };
  }
}
