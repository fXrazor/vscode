/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 7 (Desktop): Named architecture checkpoints, semantic graph comparison, restore-with-backup,
// isolated local design experiments, and clearly labelled sample validation contexts.
// Pure TypeScript with zero DOM or `vscode` runtime dependencies.

import type { DraftDocument, DraftState } from './draftDocument';
import type {
	ArchitectureCheckpoint,
	CanvasEdgeSummary,
	CanvasNodeSummary,
	SampleValidationContext
} from './protocol';

export interface SemanticDiff {
	readonly addedNodes: readonly CanvasNodeSummary[];
	readonly removedNodes: readonly CanvasNodeSummary[];
	readonly modifiedDraftIds: readonly string[];
	readonly addedEdges: readonly CanvasEdgeSummary[];
	readonly removedEdges: readonly CanvasEdgeSummary[];
	readonly hasChanges: boolean;
}

export interface ExperimentSession {
	readonly id: string;
	readonly name: string;
	readonly createdAtIso: string;
	readonly baseSourceRevision: string;
	readonly baselineState: DraftState;
}

export const MAX_STORED_CHECKPOINTS = 12;

/** Captures a named semantic checkpoint from the active DraftDocument (never includes presentation drag noise). */
export function captureCheckpoint(
	doc: DraftDocument,
	name: string,
	options?: { readonly id?: string; readonly note?: string; readonly createdAtIso?: string }
): ArchitectureCheckpoint {
	const safeName = name.trim().slice(0, 80) || 'Checkpoint';
	const createdAtIso = options?.createdAtIso ?? new Date().toISOString();
	const id = options?.id ?? `cp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
	const modifiedDraftIds = Object.keys(doc.present.drafts).sort();
	return {
		id,
		name: safeName,
		createdAtIso,
		baseSourceRevision: doc.baseSourceRevision,
		nodes: doc.present.nodes,
		edges: doc.present.edges,
		addedIds: doc.present.addedIds,
		deletedIds: doc.present.deletedIds,
		modifiedDraftIds,
		...(options?.note?.trim() ? { note: options.note.trim().slice(0, 240) } : {}),
	};
}

/** Appends a checkpoint while enforcing bounded retention (most recent checkpoints kept). */
export function appendCheckpoint(
	existing: readonly ArchitectureCheckpoint[],
	next: ArchitectureCheckpoint,
	limit = MAX_STORED_CHECKPOINTS
): readonly ArchitectureCheckpoint[] {
	const merged = [...existing.filter(c => c.id !== next.id), next];
	if (merged.length <= limit) {
		return merged;
	}
	return merged.slice(merged.length - limit);
}

/** Computes a semantic diff between a base state/checkpoint and a target state/checkpoint. */
export function compareSemanticSnapshots(
	base: {
		readonly nodes: readonly CanvasNodeSummary[];
		readonly edges: readonly CanvasEdgeSummary[];
		readonly modifiedDraftIds?: readonly string[];
	},
	target: {
		readonly nodes: readonly CanvasNodeSummary[];
		readonly edges: readonly CanvasEdgeSummary[];
		readonly modifiedDraftIds?: readonly string[];
	}
): SemanticDiff {
	const baseNodeIds = new Set(base.nodes.map(n => n.id));
	const targetNodeIds = new Set(target.nodes.map(n => n.id));
	const addedNodes = target.nodes.filter(n => !baseNodeIds.has(n.id));
	const removedNodes = base.nodes.filter(n => !targetNodeIds.has(n.id));

	const edgeKey = (e: CanvasEdgeSummary) => `${e.fromId}->${e.toId}:${e.kind}`;
	const baseEdgeSet = new Set(base.edges.map(edgeKey));
	const targetEdgeSet = new Set(target.edges.map(edgeKey));
	const addedEdges = target.edges.filter(e => !baseEdgeSet.has(edgeKey(e)));
	const removedEdges = base.edges.filter(e => !targetEdgeSet.has(edgeKey(e)));

	const baseDrafts = new Set(base.modifiedDraftIds ?? []);
	const targetDrafts = new Set(target.modifiedDraftIds ?? []);
	const modifiedDraftIds: string[] = [];
	for (const id of targetDrafts) {
		if (!baseDrafts.has(id) && baseNodeIds.has(id)) {
			modifiedDraftIds.push(id);
		}
	}
	for (const id of baseDrafts) {
		if (!targetDrafts.has(id) && targetNodeIds.has(id)) {
			modifiedDraftIds.push(id);
		}
	}
	modifiedDraftIds.sort();

	const hasChanges = addedNodes.length > 0
		|| removedNodes.length > 0
		|| addedEdges.length > 0
		|| removedEdges.length > 0
		|| modifiedDraftIds.length > 0;

	return { addedNodes, removedNodes, modifiedDraftIds, addedEdges, removedEdges, hasChanges };
}

/** Projects a stored checkpoint back into a DraftState while preserving matching schema drafts. */
export function checkpointToDraftState(
	checkpoint: ArchitectureCheckpoint,
	currentDoc: DraftDocument
): DraftState {
	const nodeSet = new Set(checkpoint.nodes.map(n => n.id));
	const retainedDrafts: Record<string, DraftDocument['present']['drafts'][string]> = {};
	for (const [id, draft] of Object.entries(currentDoc.present.drafts)) {
		if (nodeSet.has(id)) {
			retainedDrafts[id] = draft;
		}
	}
	return {
		nodes: [...checkpoint.nodes],
		edges: [...checkpoint.edges],
		drafts: retainedDrafts,
		addedIds: [...checkpoint.addedIds],
		deletedIds: [...checkpoint.deletedIds],
	};
}

/** Creates an isolated local design experiment anchored to the current semantic draft state. */
export function startExperimentSession(
	doc: DraftDocument,
	name: string,
	createdAtIso = new Date().toISOString()
): ExperimentSession {
	return {
		id: `exp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
		name: name.trim().slice(0, 64) || 'Experiment',
		createdAtIso,
		baseSourceRevision: doc.baseSourceRevision,
		baselineState: {
			nodes: [...doc.present.nodes],
			edges: [...doc.present.edges],
			drafts: { ...doc.present.drafts },
			addedIds: [...doc.present.addedIds],
			deletedIds: [...doc.present.deletedIds],
		},
	};
}

/** Returns true when a sample validation context was captured against an older source revision. */
export function isSampleContextStale(
	context: SampleValidationContext | null,
	currentSourceRevision: string
): boolean {
	if (!context) {
		return false;
	}
	return context.sourceRevision !== currentSourceRevision;
}
