import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import type { DesignConnection } from './model.ts';

const portPosition = (port: string) => port === 'top' ? Position.Top : port === 'bottom' ? Position.Bottom : port === 'input' ? Position.Left : Position.Right;

/** One geometry implementation for screen and presentation export. */
export function connectionPath(connection: DesignConnection, sourceX: number, sourceY: number, targetX: number, targetY: number) {
	const points = { sourceX, sourceY, targetX, targetY,
		sourcePosition: connection.source.kind === 'element' ? portPosition(connection.source.port ?? 'output') : sourceX <= targetX ? Position.Right : Position.Left,
		targetPosition: connection.target.kind === 'element' ? portPosition(connection.target.port ?? 'input') : sourceX <= targetX ? Position.Left : Position.Right };
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
