/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { BoardItem, Position } from './model.ts';
import type { ShapeId } from './shapes.ts';

export type DropChoice = { kind: BoardItem['kind']; shape?: ShapeId; label: string };
export const dropChoices: DropChoice[] = [
	{ kind: 'note', label: 'Sticky note' },
	{ kind: 'shape', shape: 'rectangle', label: 'Rectangle' },
	{ kind: 'shape', shape: 'ellipse', label: 'Ellipse' },
	{ kind: 'shape', shape: 'diamond', label: 'Decision' },
	{ kind: 'text', label: 'Text' },
];
/**
 * The drawing a connector creates when dropped on empty canvas: its input port (left edge,
 * vertical centre) lands on the drop point so the new link reads as a continuation.
 */
export function droppedItem(choice: DropChoice, id: string, at: Position): BoardItem {
	const width = choice.kind === 'shape' ? 160 : 220; const height = choice.kind === 'shape' ? 100 : choice.kind === 'text' ? 60 : 140;
	const position = { x: Math.round(at.x), y: Math.round(at.y - height / 2) };
	const text = choice.kind === 'note' ? 'Add a note' : choice.kind === 'text' ? 'Label' : choice.shape === 'diamond' ? 'Decision' : 'Step';
	return { id, kind: choice.kind, shape: choice.shape, text, positions: { visual: position, technical: position }, width, height, members: [] };
}

