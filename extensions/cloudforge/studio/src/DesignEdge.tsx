import { memo } from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { DesignConnection } from './model.ts';
import { connectionDash, connectionPath } from './connectionGeometry.ts';

export type DesignEdgeType = Edge<{ connection: DesignConnection; showLabel: boolean; dependency?:boolean }, 'design'>;
export const DesignEdge = memo(function DesignEdge(props: EdgeProps<DesignEdgeType>) {
	const connection = props.data!.connection;
	const [path, labelX, labelY] = connectionPath(connection, props.sourceX, props.sourceY, props.targetX, props.targetY);
	return <BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={24}
		style={{ stroke: props.data?.dependency ? 'var(--dependency)' : connection.stroke ?? 'var(--accent)', strokeWidth: connection.width ?? 1.5, strokeDasharray: props.data?.dependency ? '2 6' : props.selected ? '6 4' : connectionDash(connection), strokeLinecap: 'round' }}
		label={props.data!.showLabel || props.selected ? connection.label : undefined} labelX={labelX} labelY={labelY + (connection.labelPosition === 'above' ? -18 : connection.labelPosition === 'below' ? 18 : 0)} labelStyle={{ fill: connection.labelColor ?? 'var(--text)', fontSize: connection.labelFontSize ?? 11 }} labelBgStyle={{ fill: 'var(--panel-solid)' }}/>;
});
