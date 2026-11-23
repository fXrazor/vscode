/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 6 (Desktop): Reusable starter architecture patterns (versioned, schema-backed),
// Terraform module boundary inspection, and read-only Extract-to-Module refactoring previews.
// Pure TypeScript with zero DOM or `vscode` runtime dependencies.

import type { CanvasEdgeSummary, CanvasGraphSnapshot, CanvasNodeSummary } from './protocol';
import type { DraftValue, FormSchema, ResourceDraft } from './schemaForm';

export interface PatternTemplateMeta {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly provider: 'azure';
	readonly description: string;
	readonly resourceCount: number;
}

export interface InstantiatedPattern {
	readonly template: PatternTemplateMeta;
	readonly nodes: readonly CanvasNodeSummary[];
	readonly edges: readonly CanvasEdgeSummary[];
	readonly drafts: Readonly<Record<string, ResourceDraft>>;
}

export interface ModuleBoundaryInfo {
	readonly moduleNode: CanvasNodeSummary;
	readonly inputs: ReadonlyArray<{ readonly node: CanvasNodeSummary; readonly edgeKind: string }>;
	readonly outputs: ReadonlyArray<{ readonly node: CanvasNodeSummary; readonly edgeKind: string }>;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
}

export interface ExtractModulePreview {
	readonly moduleName: string;
	readonly selectedNodes: readonly CanvasNodeSummary[];
	readonly inferredInputs: ReadonlyArray<{ readonly variableName: string; readonly fromNode: CanvasNodeSummary; readonly toNode: CanvasNodeSummary }>;
	readonly inferredOutputs: ReadonlyArray<{ readonly outputName: string; readonly fromNode: CanvasNodeSummary; readonly toNode: CanvasNodeSummary }>;
	readonly movedBlocksHcl: string;
	readonly moduleCallHcl: string;
	readonly variablesHcl: string;
	readonly outputsHcl: string;
}

export const STARTER_PATTERNS: readonly PatternTemplateMeta[] = [
	{
		id: 'azure-hub-network',
		name: 'Azure Hub Network',
		version: '1.0.0',
		provider: 'azure',
		description: 'Resource Group, Hub VNet (10.0.0.0/16), App Subnet, NSG, and Static Public IP wired with typed HCL references.',
		resourceCount: 5,
	},
	{
		id: 'azure-secure-spoke',
		name: 'Azure Secure Spoke',
		version: '1.0.0',
		provider: 'azure',
		description: 'Resource Group, Spoke VNet (10.1.0.0/16), Workload Subnet, Route Table, and NSG.',
		resourceCount: 5,
	},
	{
		id: 'azure-edge-perimeter',
		name: 'Azure Edge Perimeter',
		version: '1.0.0',
		provider: 'azure',
		description: 'Resource Group, Standard Static Public IP, Perimeter NSG, and Edge Route Table.',
		resourceCount: 4,
	},
];

function sanitizeIdentifier(raw: string, fallback: string): string {
	const cleaned = raw.trim().replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]+/, '');
	return cleaned.length > 0 ? cleaned : fallback;
}

function allocUniqueName(usedLower: Set<string>, base: string): string {
	const root = sanitizeIdentifier(base, 'resource');
	if (!usedLower.has(root.toLowerCase())) {
		usedLower.add(root.toLowerCase());
		return root;
	}
	for (let i = 2; i < 10000; i++) {
		const candidate = `${root}_${i}`;
		if (!usedLower.has(candidate.toLowerCase())) {
			usedLower.add(candidate.toLowerCase());
			return candidate;
		}
	}
	const stamp = `${root}_${Date.now()}`;
	usedLower.add(stamp.toLowerCase());
	return stamp;
}

/** Instantiates a curated starter pattern with unique identifiers, edges, and valid schema drafts. */
export function instantiateStarterPattern(
	patternId: string,
	existingNodes: readonly CanvasNodeSummary[],
	baseSourceRevision: string,
	lookupSchema: (node: Pick<CanvasNodeSummary, 'kind' | 'resourceType'>) => FormSchema | undefined,
	seqSeed: number
): InstantiatedPattern | undefined {
	const template = STARTER_PATTERNS.find(p => p.id === patternId);
	if (!template) {
		return undefined;
	}

	const used = new Set(existingNodes.map(n => n.name.toLowerCase()));
	let seq = seqSeed;
	const nodes: CanvasNodeSummary[] = [];
	const edges: CanvasEdgeSummary[] = [];
	const drafts: Record<string, ResourceDraft> = {};

	const addNode = (
		resourceType: string,
		baseName: string,
		attrs: Record<string, DraftValue>
	): CanvasNodeSummary => {
		const name = allocUniqueName(used, baseName);
		const id = `draft:${resourceType}.${name}:${seq++}`;
		const node: CanvasNodeSummary = {
			id,
			kind: 'resource',
			resourceType,
			name,
			label: `${resourceType}.${name}`,
			hasSource: false,
		};
		nodes.push(node);
		const schema = lookupSchema(node);
		if (schema) {
			drafts[id] = {
				draftId: `draft:${id}:${baseSourceRevision.slice(0, 8)}`,
				baseSourceRevision,
				kind: schema.kind,
				typeName: resourceType,
				label: name,
				attributes: {
					name: { kind: 'literal', value: name.replace(/_/g, '-') },
					...attrs,
				},
				blocks: [],
			};
		}
		return node;
	};

	const expr = (text: string): DraftValue => ({ kind: 'expression', text });
	const lit = (value: string | number | boolean | readonly string[]): DraftValue => ({ kind: 'literal', value });

	if (patternId === 'azure-hub-network') {
		const rg = addNode('azurerm_resource_group', 'rg_hub', { location: lit('uksouth') });
		const vnet = addNode('azurerm_virtual_network', 'vnet_hub', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
			address_space: lit(['10.0.0.0/16']),
		});
		const subnet = addNode('azurerm_subnet', 'snet_apps', {
			resource_group_name: expr(`${rg.label}.name`),
			virtual_network_name: expr(`${vnet.label}.name`),
			address_prefixes: lit(['10.0.1.0/24']),
		});
		const nsg = addNode('azurerm_network_security_group', 'nsg_hub', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
		});
		const pip = addNode('azurerm_public_ip', 'pip_hub_ingress', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
			allocation_method: lit('Static'),
			sku: lit('Standard'),
		});
		edges.push(
			{ fromId: rg.id, toId: vnet.id, kind: 'reference' },
			{ fromId: rg.id, toId: subnet.id, kind: 'reference' },
			{ fromId: vnet.id, toId: subnet.id, kind: 'reference' },
			{ fromId: rg.id, toId: nsg.id, kind: 'reference' },
			{ fromId: rg.id, toId: pip.id, kind: 'reference' }
		);
	} else if (patternId === 'azure-secure-spoke') {
		const rg = addNode('azurerm_resource_group', 'rg_spoke', { location: lit('uksouth') });
		const vnet = addNode('azurerm_virtual_network', 'vnet_spoke', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
			address_space: lit(['10.1.0.0/16']),
		});
		const subnet = addNode('azurerm_subnet', 'snet_workload', {
			resource_group_name: expr(`${rg.label}.name`),
			virtual_network_name: expr(`${vnet.label}.name`),
			address_prefixes: lit(['10.1.1.0/24']),
		});
		const rt = addNode('azurerm_route_table', 'rt_spoke', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
		});
		const nsg = addNode('azurerm_network_security_group', 'nsg_spoke', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
		});
		edges.push(
			{ fromId: rg.id, toId: vnet.id, kind: 'reference' },
			{ fromId: rg.id, toId: subnet.id, kind: 'reference' },
			{ fromId: vnet.id, toId: subnet.id, kind: 'reference' },
			{ fromId: rg.id, toId: rt.id, kind: 'reference' },
			{ fromId: rg.id, toId: nsg.id, kind: 'reference' }
		);
	} else if (patternId === 'azure-edge-perimeter') {
		const rg = addNode('azurerm_resource_group', 'rg_edge', { location: lit('uksouth') });
		const pip = addNode('azurerm_public_ip', 'pip_edge', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
			allocation_method: lit('Static'),
			sku: lit('Standard'),
		});
		const nsg = addNode('azurerm_network_security_group', 'nsg_edge', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
		});
		const rt = addNode('azurerm_route_table', 'rt_edge', {
			location: expr(`${rg.label}.location`),
			resource_group_name: expr(`${rg.label}.name`),
		});
		edges.push(
			{ fromId: rg.id, toId: pip.id, kind: 'reference' },
			{ fromId: rg.id, toId: nsg.id, kind: 'reference' },
			{ fromId: rg.id, toId: rt.id, kind: 'reference' }
		);
	}

	return { template, nodes, edges, drafts };
}

/** Computes boundary inputs, outputs, and diagnostics for a Terraform module declaration node. */
export function inspectModuleBoundary(graph: CanvasGraphSnapshot, moduleNodeId: string): ModuleBoundaryInfo | undefined {
	const moduleNode = graph.nodes.find(n => n.id === moduleNodeId && n.kind.toLowerCase() === 'module');
	if (!moduleNode) {
		return undefined;
	}
	const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
	const inputs: { readonly node: CanvasNodeSummary; readonly edgeKind: string }[] = [];
	const outputs: { readonly node: CanvasNodeSummary; readonly edgeKind: string }[] = [];

	for (const edge of graph.edges) {
		if (edge.toId === moduleNode.id) {
			const src = nodeMap.get(edge.fromId);
			if (src) {
				inputs.push({ node: src, edgeKind: edge.kind });
			}
		} else if (edge.fromId === moduleNode.id) {
			const dst = nodeMap.get(edge.toId);
			if (dst) {
				outputs.push({ node: dst, edgeKind: edge.kind });
			}
		}
	}

	const lowerName = moduleNode.name.toLowerCase();
	const diagnostics = graph.diagnostics.filter(d =>
		d.message.toLowerCase().includes(lowerName) || d.code.toLowerCase().includes('module')
	);

	return { moduleNode, inputs, outputs, diagnostics };
}

/** Generates a read-only Extract-to-Module source refactoring preview including `moved` blocks. */
export function buildExtractModulePreview(
	graph: CanvasGraphSnapshot,
	selectedIds: readonly string[],
	rawModuleName: string
): ExtractModulePreview | undefined {
	const selectedSet = new Set(selectedIds);
	const selectedNodes = graph.nodes.filter(n => selectedSet.has(n.id));
	if (selectedNodes.length === 0) {
		return undefined;
	}
	const moduleName = sanitizeIdentifier(rawModuleName, 'extracted_module');
	const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
	const inferredInputs: { readonly variableName: string; readonly fromNode: CanvasNodeSummary; readonly toNode: CanvasNodeSummary }[] = [];
	const inferredOutputs: { readonly outputName: string; readonly fromNode: CanvasNodeSummary; readonly toNode: CanvasNodeSummary }[] = [];
	const seenInputVars = new Set<string>();
	const seenOutputVars = new Set<string>();

	for (const edge of graph.edges) {
		const fromSelected = selectedSet.has(edge.fromId);
		const toSelected = selectedSet.has(edge.toId);
		if (!fromSelected && toSelected) {
			const fromNode = nodeById.get(edge.fromId);
			const toNode = nodeById.get(edge.toId);
			if (fromNode && toNode) {
				const variableName = sanitizeIdentifier(`${fromNode.name}_id`, 'upstream_id');
				if (!seenInputVars.has(variableName)) {
					seenInputVars.add(variableName);
					inferredInputs.push({ variableName, fromNode, toNode });
				}
			}
		} else if (fromSelected && !toSelected) {
			const fromNode = nodeById.get(edge.fromId);
			const toNode = nodeById.get(edge.toId);
			if (fromNode && toNode) {
				const outputName = sanitizeIdentifier(`${fromNode.name}_id`, 'exported_id');
				if (!seenOutputVars.has(outputName)) {
					seenOutputVars.add(outputName);
					inferredOutputs.push({ outputName, fromNode, toNode });
				}
			}
		}
	}

	const callLines = [
		`# Read-only refactoring preview — no Terraform files have been modified.`,
		`module "${moduleName}" {`,
		`  source = "./modules/${moduleName}"`,
	];
	for (const inp of inferredInputs) {
		callLines.push(`  ${inp.variableName} = ${inp.fromNode.label}.id`);
	}
	callLines.push('}');

	const movedLines = [
		`# State migration blocks to preserve existing cloud resources without replacement:`,
	];
	for (const node of selectedNodes) {
		if (node.kind.toLowerCase() === 'resource' && node.resourceType) {
			movedLines.push(
				`moved {`,
				`  from = ${node.label}`,
				`  to   = module.${moduleName}.${node.label}`,
				`}`,
				''
			);
		}
	}

	const varLines = inferredInputs.length > 0
		? inferredInputs.flatMap(inp => [
			`variable "${inp.variableName}" {`,
			`  type        = string`,
			`  description = "Reference passed from ${inp.fromNode.label} for ${inp.toNode.label}."`,
			`}`,
			'',
		])
		: ['# No external upstream dependencies detected for this selection.'];

	const outLines = inferredOutputs.length > 0
		? inferredOutputs.flatMap(out => [
			`output "${out.outputName}" {`,
			`  value       = ${out.fromNode.label}.id`,
			`  description = "Consumed downstream by ${out.toNode.label}."`,
			`}`,
			'',
		])
		: ['# No external downstream consumers detected for this selection.'];

	return {
		moduleName,
		selectedNodes,
		inferredInputs,
		inferredOutputs,
		movedBlocksHcl: movedLines.join('\n').trimEnd(),
		moduleCallHcl: callLines.join('\n'),
		variablesHcl: varLines.join('\n').trimEnd(),
		outputsHcl: outLines.join('\n').trimEnd(),
	};
}
