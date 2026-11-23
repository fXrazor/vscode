// Resource catalogue contracts.
// A catalogue entry is an infrastructure definition, not a picture: it names the real
// Terraform type, the arguments the provider accepts (checked against the local provider
// repositories by scripts/verify-catalog.mjs), what it exports, where it may be placed and
// which settings it inherits from the container it is dropped into.

export type ProviderId = "azurerm" | "aws" | "google" | "kubernetes";

export type AttrType =
  | "string"
  | "number"
  | "bool"
  | "list"
  | "map"
  | "block";

export interface AttrDef {
  name: string;
  type: AttrType;
  required?: boolean;
  description: string;
  default?: unknown;
  /** Allowed values (rendered as a select). */
  options?: string[];
  /** Resource types this argument may point at (makes relationship lines). */
  refTypes?: string[];
  /** Which exported attribute of the referenced resource is used (default "id"). */
  refAttr?: string;
  /** Value is a CIDR (or list of CIDRs) and gets network validation. */
  cidr?: boolean;
  /** Never written as a literal: always generated as a sensitive variable. */
  sensitive?: boolean;
  /** For blocks: the nested arguments. */
  children?: AttrDef[];
  /** For blocks: can be repeated (rendered as a list of blocks). */
  repeat?: boolean;
  /** Placeholder shown in the form. */
  placeholder?: string;
  /** The provider documentation marks this argument deprecated. */
  deprecated?: boolean;
}

/** Container inheritance: a child placed inside `fromType` gets `attr = ref(container).fromAttr`. */
export interface InheritRule {
  attr: string;
  fromType: string;
  fromAttr: string;
}

export interface ResourceDef {
  /** Terraform resource type, also the catalogue id. */
  type: string;
  provider: ProviderId;
  service: string;
  category: string;
  displayName: string;
  /** Path under /icons/ (public folder). */
  icon: string;
  /** Can hold other nodes. */
  container?: boolean;
  /** Container types this resource may be placed in. Empty = top level only. */
  parents: string[];
  attributes: AttrDef[];
  exported: string[];
  inherit: InheritRule[];
  /** Arguments used when the node is switched to a data source. Absent = no data source. */
  dataArgs?: string[];
  /** Extra words for search. */
  aliases?: string[];
  /** Plain-language explanation for learning mode. */
  learn: string;
  /** Path of the provider documentation page inside the local provider repository. */
  docPath: string;
  /**
   * Built by scripts/build-provider-index.ts from the provider documentation (argument types
   * inferred) rather than written and reviewed by hand.
   */
  generated?: boolean;
  /** How the icon was chosen for a generated entry: by resource name, by service, or generic. */
  iconMatch?: "type" | "service" | "generic";
}

export interface ModuleInput {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  default?: unknown;
}

export interface ModuleDef {
  id: string;
  provider: ProviderId;
  displayName: string;
  source: string;
  version: string;
  icon: string;
  inputs: ModuleInput[];
  outputs: string[];
  learn: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  source: string;
  /** Default constraint; the project can change it. */
  defaultConstraint: string;
  /** Version the catalogue's arguments were checked against (local repository tag). */
  verifiedAgainst: string;
  repo: string;
  docsDir: string;
}
