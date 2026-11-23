/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 4 (Desktop Foundation): Shared semantic architecture draft document, single undo/redo
// history across Visual Design, Technical Design, and Focused Resource Workspace, plus
// deterministic reviewable Terraform HCL generation preview.
// Pure TypeScript with zero runtime `vscode` or DOM imports.
// Trust boundary: all edits stay strictly in memory bound to `baseSourceRevision` until Rust's
// guarded atomic save capability is approved and connected.

import type { CanvasEdgeSummary, CanvasGraphSnapshot, CanvasNodeSummary } from './protocol';
import type { FormSchema, RenderedDraft, ResourceDraft } from './schemaForm';

export interface DraftCheckpoint {
	readonly reason: string;
	readonly snapshot: DraftState;
}

export interface DraftState {
	readonly nodes: readonly CanvasNodeSummary[];
	readonly edges: readonly CanvasEdgeSummary[];
	readonly drafts: Readonly<Record<string, ResourceDraft>>;
	readonly addedIds: readonly string[];
	readonly deletedIds: readonly string[];
}

export interface DraftDocument {
	readonly baseGraph: CanvasGraphSnapshot;
	readonly baseSourceRevision: string;
	readonly present: DraftState;
	readonly past: readonly DraftCheckpoint[];
	readonly future: readonly DraftCheckpoint[];
}

export type DraftEdit =
	| { readonly type: 'addResource'; readonly node: CanvasNodeSummary; readonly initialDraft?: ResourceDraft }
	| { readonly type: 'insertPattern'; readonly patternName: string; readonly nodes: readonly CanvasNodeSummary[]; readonly edges: readonly CanvasEdgeSummary[]; readonly drafts: Readonly<Record<string, ResourceDraft>> }
	| { readonly type: 'duplicateResource'; readonly sourceNodeId: string; readonly newNodeId: string; readonly newName: string }
	| { readonly type: 'deleteResource'; readonly nodeId: string }
	| { readonly type: 'connectResources'; readonly fromId: string; readonly toId: string; readonly kind?: string }
	| { readonly type: 'updateDraft'; readonly nodeId: string; readonly draft: ResourceDraft }
	| { readonly type: 'restoreSnapshot'; readonly reason: string; readonly snapshot: DraftState };

export interface DraftChangeSummary {
	readonly dirty: boolean;
	readonly added: readonly CanvasNodeSummary[];
	readonly modified: readonly CanvasNodeSummary[];
	readonly deleted: readonly CanvasNodeSummary[];
	readonly addedEdges: number;
	readonly removedEdges: number;
}

export interface GeneratedTerraformPreview {
	readonly baseSourceRevision: string;
	readonly hcl: string;
	readonly resourceCount: number;
	readonly hasErrors: boolean;
	readonly diagnosticsCount: number;
}

const MAX_HISTORY = 100;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function createDraftDocument(baseGraph: CanvasGraphSnapshot): DraftDocument {
	return {
		baseGraph,
		baseSourceRevision: baseGraph.sourceRevision,
		present: {
			nodes: [...baseGraph.nodes],
			edges: [...baseGraph.edges],
			drafts: {},
			addedIds: [],
			deletedIds: [],
		},
		past: [],
		future: [],
	};
}

/** Projects the current in-memory draft back into a `CanvasGraphSnapshot` for rendering and validation. */
export function projectDraftGraph(doc: DraftDocument): CanvasGraphSnapshot {
	return {
		...doc.baseGraph,
		nodes: doc.present.nodes,
		edges: doc.present.edges,
	};
}

/** Suggests a unique valid Terraform identifier for a new or duplicated resource. */
export function uniqueResourceName(nodes: readonly CanvasNodeSummary[], baseName: string): string {
	const sanitized = baseName.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]+/, 'r_');
	const root = sanitized.length > 0 && IDENTIFIER_PATTERN.test(sanitized) ? sanitized : 'resource';
	const existing = new Set(nodes.map(n => n.name.toLowerCase()));
	if (!existing.has(root.toLowerCase())) {
		return root;
	}
	for (let suffix = 2; suffix < 10000; suffix++) {
		const candidate = `${root}_${suffix}`;
		if (!existing.has(candidate.toLowerCase())) {
			return candidate;
		}
	}
	return `${root}_${Date.now()}`;
}

function wouldCreateCycle(edges: readonly CanvasEdgeSummary[], fromId: string, toId: string): boolean {
	if (fromId === toId) {
		return true;
	}
	// Check if `fromId` is already reachable from `toId`.
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		let list = adj.get(e.fromId);
		if (!list) {
			list = [];
			adj.set(e.fromId, list);
		}
		list.push(e.toId);
	}
	const visited = new Set<string>([toId]);
	const stack = [toId];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const next of adj.get(cur) ?? []) {
			if (next === fromId) {
				return true;
			}
			if (!visited.has(next)) {
				visited.add(next);
				stack.push(next);
			}
		}
	}
	return false;
}

function reduceState(state: DraftState, edit: DraftEdit): { readonly next: DraftState; readonly reason: string } | undefined {
	switch (edit.type) {
		case 'addResource': {
			if (!IDENTIFIER_PATTERN.test(edit.node.name)) {
				return undefined;
			}
			if (state.nodes.some(n => n.id === edit.node.id)) {
				return undefined;
			}
			const nextDrafts = edit.initialDraft
				? { ...state.drafts, [edit.node.id]: edit.initialDraft }
				: state.drafts;
			return {
				reason: `Add ${edit.node.name}`,
				next: {
					...state,
					nodes: [...state.nodes, edit.node],
					drafts: nextDrafts,
					addedIds: [...state.addedIds, edit.node.id],
				},
			};
		}
		case 'insertPattern': {
			if (edit.nodes.length === 0) {
				return undefined;
			}
			const existingIds = new Set(state.nodes.map(n => n.id));
			const validNodes = edit.nodes.filter(n => IDENTIFIER_PATTERN.test(n.name) && !existingIds.has(n.id));
			if (validNodes.length === 0) {
				return undefined;
			}
			const newIds = new Set(validNodes.map(n => n.id));
			const allIds = new Set([...existingIds, ...newIds]);
			const nextEdges = [...state.edges];
			for (const edge of edit.edges) {
				if (
					allIds.has(edge.fromId)
					&& allIds.has(edge.toId)
					&& edge.fromId !== edge.toId
					&& !nextEdges.some(e => e.fromId === edge.fromId && e.toId === edge.toId)
					&& !wouldCreateCycle(nextEdges, edge.fromId, edge.toId)
				) {
					nextEdges.push(edge);
				}
			}
			const nextDrafts: Record<string, ResourceDraft> = { ...state.drafts };
			for (const [id, draft] of Object.entries(edit.drafts)) {
				if (newIds.has(id)) {
					nextDrafts[id] = draft;
				}
			}
			return {
				reason: `Insert pattern: ${edit.patternName}`,
				next: {
					...state,
					nodes: [...state.nodes, ...validNodes],
					edges: nextEdges,
					drafts: nextDrafts,
					addedIds: [...state.addedIds, ...validNodes.map(n => n.id)],
				},
			};
		}
		case 'restoreSnapshot': {
			return {
				reason: edit.reason,
				next: {
					nodes: [...edit.snapshot.nodes],
					edges: [...edit.snapshot.edges],
					drafts: { ...edit.snapshot.drafts },
					addedIds: [...edit.snapshot.addedIds],
					deletedIds: [...edit.snapshot.deletedIds],
				},
			};
		}
		case 'duplicateResource': {
			const source = state.nodes.find(n => n.id === edit.sourceNodeId);
			if (!source || !IDENTIFIER_PATTERN.test(edit.newName) || state.nodes.some(n => n.id === edit.newNodeId)) {
				return undefined;
			}
			const label = source.resourceType ? `${source.resourceType}.${edit.newName}` : edit.newName;
			const copyNode: CanvasNodeSummary = {
				id: edit.newNodeId,
				kind: source.kind,
				resourceType: source.resourceType,
				name: edit.newName,
				label,
				hasSource: false,
			};
			const sourceDraft = state.drafts[source.id];
			const nextDrafts: Readonly<Record<string, ResourceDraft>> = sourceDraft
				? {
					...state.drafts,
					[copyNode.id]: {
						...sourceDraft,
						draftId: `draft:${copyNode.id}:${sourceDraft.baseSourceRevision.slice(0, 8)}`,
						label: edit.newName,
						attributes: { ...sourceDraft.attributes, name: { kind: 'literal' as const, value: edit.newName } },
						blocks: sourceDraft.blocks.map((b, i) => ({ ...b, id: `${b.id}-dup-${i}`, attributes: { ...b.attributes } })),
					},
				}
				: state.drafts;
			return {
				reason: `Duplicate ${source.name}`,
				next: {
					...state,
					nodes: [...state.nodes, copyNode],
					drafts: nextDrafts,
					addedIds: [...state.addedIds, copyNode.id],
				},
			};
		}
		case 'deleteResource': {
			const target = state.nodes.find(n => n.id === edit.nodeId);
			if (!target) {
				return undefined;
			}
			const wasAdded = state.addedIds.includes(edit.nodeId);
			const nextDrafts = { ...state.drafts };
			delete nextDrafts[edit.nodeId];
			return {
				reason: `Delete ${target.name}`,
				next: {
					nodes: state.nodes.filter(n => n.id !== edit.nodeId),
					edges: state.edges.filter(e => e.fromId !== edit.nodeId && e.toId !== edit.nodeId),
					drafts: nextDrafts,
					addedIds: state.addedIds.filter(id => id !== edit.nodeId),
					deletedIds: wasAdded ? state.deletedIds : [...state.deletedIds, edit.nodeId],
				},
			};
		}
		case 'connectResources': {
			const hasFrom = state.nodes.some(n => n.id === edit.fromId);
			const hasTo = state.nodes.some(n => n.id === edit.toId);
			if (!hasFrom || !hasTo || edit.fromId === edit.toId) {
				return undefined;
			}
			if (state.edges.some(e => e.fromId === edit.fromId && e.toId === edit.toId)) {
				return undefined;
			}
			if (wouldCreateCycle(state.edges, edit.fromId, edit.toId)) {
				return undefined;
			}
			return {
				reason: 'Connect resources',
				next: {
					...state,
					edges: [...state.edges, { fromId: edit.fromId, toId: edit.toId, kind: edit.kind ?? 'reference' }],
				},
			};
		}
		case 'updateDraft': {
			if (!state.nodes.some(n => n.id === edit.nodeId)) {
				return undefined;
			}
			return {
				reason: `Edit ${edit.draft.label}`,
				next: {
					...state,
					drafts: { ...state.drafts, [edit.nodeId]: edit.draft },
				},
			};
		}
	}
}

export function applyDraftEdit(doc: DraftDocument, edit: DraftEdit): DraftDocument {
	const result = reduceState(doc.present, edit);
	if (!result) {
		return doc;
	}
	const checkpoint: DraftCheckpoint = { reason: result.reason, snapshot: doc.present };
	const past = doc.past.length >= MAX_HISTORY
		? [...doc.past.slice(doc.past.length - MAX_HISTORY + 1), checkpoint]
		: [...doc.past, checkpoint];
	return {
		...doc,
		present: result.next,
		past,
		future: [],
	};
}

export function undoDraftEdit(doc: DraftDocument): DraftDocument {
	const last = doc.past.at(-1);
	if (!last) {
		return doc;
	}
	return {
		...doc,
		present: last.snapshot,
		past: doc.past.slice(0, -1),
		future: [{ reason: last.reason, snapshot: doc.present }, ...doc.future],
	};
}

export function redoDraftEdit(doc: DraftDocument): DraftDocument {
	const next = doc.future[0];
	if (!next) {
		return doc;
	}
	return {
		...doc,
		present: next.snapshot,
		past: [...doc.past, { reason: next.reason, snapshot: doc.present }],
		future: doc.future.slice(1),
	};
}

export function revertDraftDocument(doc: DraftDocument): DraftDocument {
	return createDraftDocument(doc.baseGraph);
}

export function computeDraftChangeSummary(doc: DraftDocument): DraftChangeSummary {
	const addedSet = new Set(doc.present.addedIds);
	const deletedSet = new Set(doc.present.deletedIds);
	const added = doc.present.nodes.filter(n => addedSet.has(n.id));
	const modified = doc.present.nodes.filter(n => !addedSet.has(n.id) && Object.hasOwn(doc.present.drafts, n.id));
	const deleted = doc.baseGraph.nodes.filter(n => deletedSet.has(n.id));

	const baseEdgeKeys = new Set(doc.baseGraph.edges.map(e => `${e.fromId}->${e.toId}:${e.kind}`));
	const curEdgeKeys = new Set(doc.present.edges.map(e => `${e.fromId}->${e.toId}:${e.kind}`));
	let addedEdges = 0;
	let removedEdges = 0;
	for (const k of curEdgeKeys) {
		if (!baseEdgeKeys.has(k)) {
			addedEdges++;
		}
	}
	for (const k of baseEdgeKeys) {
		if (!curEdgeKeys.has(k)) {
			removedEdges++;
		}
	}

	const dirty = added.length > 0 || modified.length > 0 || deleted.length > 0 || addedEdges > 0 || removedEdges > 0;
	return { dirty, added, modified, deleted, addedEdges, removedEdges };
}

/** Deterministically generates a reviewable Terraform HCL preview for all added/modified schema-backed resources. */
export function generateTerraformPreview(
	doc: DraftDocument,
	lookupSchema: (node: CanvasNodeSummary) => FormSchema | undefined,
	renderDraft: (schema: FormSchema, draft: ResourceDraft) => RenderedDraft
): GeneratedTerraformPreview {
	const summary = computeDraftChangeSummary(doc);
	const sections: string[] = [
		`# CloudForge unsaved Terraform generation preview`,
		`# Base revision: ${doc.baseSourceRevision.slice(0, 8)} · Added: ${summary.added.length}, Modified: ${summary.modified.length}, Marked deleted: ${summary.deleted.length}`,
		`# Read-only preview: no project files on disk have been modified.`,
		'',
	];

	let resourceCount = 0;
	let hasErrors = false;
	let diagnosticsCount = 0;

	const targets = [...summary.added, ...summary.modified].sort((a, b) => a.label.localeCompare(b.label));
	for (const node of targets) {
		const schema = lookupSchema(node);
		const draft = doc.present.drafts[node.id];
		if (!schema || !draft) {
			sections.push(`# ${node.label}: no bundled schema draft to render (edit in native Terraform source).`, '');
			continue;
		}
		const rendered = renderDraft(schema, draft);
		resourceCount++;
		diagnosticsCount += rendered.diagnostics.length;
		if (rendered.hasErrors) {
			hasErrors = true;
		}
		sections.push(rendered.hcl.trimEnd(), '');
	}

	if (summary.deleted.length > 0) {
		sections.push('# Resources marked for removal in this draft:');
		for (const node of summary.deleted) {
			sections.push(`#   - ${node.label}`);
		}
		sections.push('');
	}

	return {
		baseSourceRevision: doc.baseSourceRevision,
		hcl: sections.join('\n'),
		resourceCount,
		hasErrors,
		diagnosticsCount,
	};
}
