import { memo } from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { DesignConnection } from './model.ts';
import { connectionDash, connectionPath } from './connectionGeometry.ts';

export type DesignEdgeType = Edge<{ connection: DesignConnection; showLabel: boolean }, 'design'>;
export const DesignEdge = memo(function DesignEdge(props: EdgeProps<DesignEdgeType>) {
	const connection = props.data!.connection;
	const [path, labelX, labelY] = connectionPath(connection, props.sourceX, props.sourceY, props.targetX, props.targetY);
	return <BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={24}
		style={{ stroke: connection.stroke ?? 'var(--accent)', strokeWidth: connection.width ?? 1.5, strokeDasharray: props.selected ? '6 4' : connectionDash(connection), strokeLinecap: 'round' }}
		label={props.data!.showLabel || props.selected ? connection.label : undefined} labelX={labelX} labelY={labelY} labelStyle={{ fill: 'var(--text)', fontSize: 11 }} labelBgStyle={{ fill: 'var(--panel-solid)' }}/>;
});
