/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import type { DesignConnection } from './model.ts';

const portPosition = (port: string) => port === 'top' ? Position.Top : port === 'bottom' ? Position.Bottom : port === 'input' ? Position.Left : Position.Right;
const isVertical = (pos: Position) => pos === Position.Top || pos === Position.Bottom;

function roundedOrthogonalPath(rawPoints: readonly { readonly x: number; readonly y: number }[], radius = 5): string {
	// Collapse duplicates and collinear intermediate points so corners stay clean.
	const pts: { x: number; y: number }[] = [];
	for (const pt of rawPoints) {
		const prev = pts.at(-1);
		if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.01) { continue; }
		pts.push({ x: pt.x, y: pt.y });
	}
	const simplified: { x: number; y: number }[] = [];
	for (const pt of pts) {
		while (simplified.length >= 2) {
			const a = simplified[simplified.length - 2];
			const b = simplified[simplified.length - 1];
			const collinearX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - pt.x) < 0.01;
			const collinearY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - pt.y) < 0.01;
			if (collinearX || collinearY) { simplified.pop(); }
			else { break; }
		}
		simplified.push(pt);
	}
	if (simplified.length < 2) {
		const only = simplified[0] ?? { x: 0, y: 0 };
		return `M${only.x},${only.y}`;
	}
	let d = `M${simplified[0].x},${simplified[0].y}`;
	for (let i = 1; i < simplified.length - 1; i++) {
		const prev = simplified[i - 1];
		const cur = simplified[i];
		const next = simplified[i + 1];
		const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
		const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
		const r = Math.min(radius, d1 / 2, d2 / 2);
		if (r < 0.5) {
			d += ` L${cur.x},${cur.y}`;
			continue;
		}
		const sx = cur.x - ((cur.x - prev.x) / d1) * r;
		const sy = cur.y - ((cur.y - prev.y) / d1) * r;
		const ex = cur.x + ((next.x - cur.x) / d2) * r;
		const ey = cur.y + ((next.y - cur.y) / d2) * r;
		d += ` L${sx},${sy} Q${cur.x},${cur.y} ${ex},${ey}`;
	}
	const last = simplified[simplified.length - 1];
	return `${d} L${last.x},${last.y}`;
}

/** One geometry implementation for screen and presentation export. */
export function connectionPath(connection: DesignConnection, sourceX: number, sourceY: number, targetX: number, targetY: number): [string, number, number, number, number] {
	const sourcePosition = connection.source.kind === 'element' ? portPosition(connection.source.port ?? 'output') : sourceX <= targetX ? Position.Right : Position.Left;
	const targetPosition = connection.target.kind === 'element' ? portPosition(connection.target.port ?? 'input') : sourceX <= targetX ? Position.Left : Position.Right;
	const wp = connection.waypoint;
	if (wp && Number.isFinite(wp.x) && Number.isFinite(wp.y)) {
		const wx = wp.x;
		const wy = wp.y;
		if (connection.routing === 'straight') {
			return [`M${sourceX},${sourceY} L${wx},${wy} L${targetX},${targetY}`, wx, wy, 0, 0];
		}
		if (connection.routing === 'curve') {
			// Quadratic Bezier passing directly through (wx, wy) at t = 0.5.
			const cx = Math.round((2 * wx - (sourceX + targetX) / 2) * 100) / 100;
			const cy = Math.round((2 * wy - (sourceY + targetY) / 2) * 100) / 100;
			return [`M${sourceX},${sourceY} Q${cx},${cy} ${targetX},${targetY}`, wx, wy, 0, 0];
		}
		// Elbow: rounded 90-degree orthogonal route honouring source/target port axes through (wx, wy).
		const sVert = isVertical(sourcePosition);
		const tVert = isVertical(targetPosition);
		let raw: { x: number; y: number }[];
		if (!sVert && !tVert) {
			const minY = Math.min(sourceY, targetY);
			const maxY = Math.max(sourceY, targetY);
			if (Math.abs(sourceY - targetY) > 8 && wy >= minY && wy <= maxY) {
				raw = [{ x: sourceX, y: sourceY }, { x: wx, y: sourceY }, { x: wx, y: wy }, { x: wx, y: targetY }, { x: targetX, y: targetY }];
			} else {
				const sDir = sourcePosition === Position.Left ? -1 : 1;
				const tDir = targetPosition === Position.Left ? -1 : 1;
				const stub = Math.min(24, Math.max(12, Math.abs(targetX - sourceX) / 4));
				const sx = sourceX + sDir * stub;
				const tx = targetX + tDir * stub;
				raw = [{ x: sourceX, y: sourceY }, { x: sx, y: sourceY }, { x: sx, y: wy }, { x: wx, y: wy }, { x: tx, y: wy }, { x: tx, y: targetY }, { x: targetX, y: targetY }];
			}
		} else if (sVert && tVert) {
			const minX = Math.min(sourceX, targetX);
			const maxX = Math.max(sourceX, targetX);
			if (Math.abs(sourceX - targetX) > 8 && wx >= minX && wx <= maxX) {
				raw = [{ x: sourceX, y: sourceY }, { x: sourceX, y: wy }, { x: wx, y: wy }, { x: targetX, y: wy }, { x: targetX, y: targetY }];
			} else {
				const sDir = sourcePosition === Position.Top ? -1 : 1;
				const tDir = targetPosition === Position.Top ? -1 : 1;
				const stub = Math.min(24, Math.max(12, Math.abs(targetY - sourceY) / 4));
				const sy = sourceY + sDir * stub;
				const ty = targetY + tDir * stub;
				raw = [{ x: sourceX, y: sourceY }, { x: sourceX, y: sy }, { x: wx, y: sy }, { x: wx, y: wy }, { x: wx, y: ty }, { x: targetX, y: ty }, { x: targetX, y: targetY }];
			}
		} else {
			const firstBend = sVert ? { x: sourceX, y: wy } : { x: wx, y: sourceY };
			const secondBend = tVert ? { x: targetX, y: wy } : { x: wx, y: targetY };
			raw = [{ x: sourceX, y: sourceY }, firstBend, { x: wx, y: wy }, secondBend, { x: targetX, y: targetY }];
		}
		const d = roundedOrthogonalPath(raw, 5);
		return [d, wx, wy, 0, 0];
	}
	const points = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
	return connection.routing === 'straight' ? getStraightPath(points) : connection.routing === 'curve' ? getBezierPath(points) : getSmoothStepPath({ ...points, borderRadius: 5 });
}

/** Conservative SVG path bounds include curve control points, used by export and focus. */
export function connectionPathBounds(connection: DesignConnection, sourceX: number, sourceY: number, targetX: number, targetY: number) {
	const values = connectionPath(connection, sourceX, sourceY, targetX, targetY)[0].match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
	const xs = values.filter((_, index) => index % 2 === 0); const ys = values.filter((_, index) => index % 2 === 1);
	const x = Math.min(sourceX, targetX, ...xs); const y = Math.min(sourceY, targetY, ...ys);
	return { x, y, width: Math.max(sourceX, targetX, ...xs) - x, height: Math.max(sourceY, targetY, ...ys) - y };
}

export function connectionDash(connection: DesignConnection) {
	const width = connection.width ?? 1.5;
	return connection.pattern === 'dashed' ? `${width * 4} ${width * 3}` : connection.pattern === 'dotted' ? `${width} ${width * 3}` : undefined;
}
