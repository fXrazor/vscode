import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import type { DesignConnection } from './model.ts';

/** One geometry implementation for screen and presentation export. */
export function connectionPath(connection: DesignConnection, sourceX: number, sourceY: number, targetX: number, targetY: number) {
	const points = { sourceX, sourceY, targetX, targetY, sourcePosition: Position.Right, targetPosition: Position.Left };
	return connection.routing === 'straight' ? getStraightPath(points) : connection.routing === 'curve' ? getBezierPath(points) : getSmoothStepPath({ ...points, borderRadius: 5 });
}

export function connectionDash(connection: DesignConnection) {
	const width = connection.width ?? 1.5;
	return connection.pattern === 'dashed' ? `${width * 4} ${width * 3}` : connection.pattern === 'dotted' ? `${width} ${width * 3}` : undefined;
}
