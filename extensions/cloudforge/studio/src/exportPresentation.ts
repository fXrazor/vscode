import { shapeDefinition, shapeTextColor, shapeStrokeDash } from './shapes.ts';
import { inkDefaults } from './ink.ts';
import { connectionPath, connectionDash } from './connectionGeometry.ts';
import { connectionAnchor } from './designConnections.ts';
import type { Architecture, BoardItem } from './model.ts';
import { sceneOrder } from './canvasOperations.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { resourceDefinition } from './fixture.ts';
import { isResourceContainer, resourceDimensions } from './resourceHierarchy.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

/** Portable SVG text with explicit line positions; no HTML foreignObject dependency. */
function drawingMarkup(item: BoardItem): string {
	const { x, y } = item.positions.visual;
	if (item.kind === 'ink') {
		// Path data is built by ink.ts; only path commands and numbers are allowed through.
		const path = /^[MLQl0-9 .\-]*$/.test(item.path ?? '') ? item.path ?? '' : '';
		const width = item.strokeWidth ?? inkDefaults.strokeWidth; const inkDash = shapeStrokeDash(item.strokeStyle ?? 'solid', width);
		return `<g data-element="${escape(item.id)}" aria-label="Freehand drawing" transform="translate(${x},${y})" opacity="${item.opacity ?? 1}"><svg width="${item.width}" height="${item.height}" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"><path d="${path}" fill="none" stroke="${escape(item.strokeColor ?? inkDefaults.strokeColor)}" stroke-width="${width}" ${inkDash ? `stroke-dasharray="${inkDash}"` : ''} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></g>`;
	}
	const fill = item.fill ?? (item.kind === 'note' ? '#fff0b5' : item.kind === 'shape' ? '#eef2ff' : 'transparent');
	const fontSize = item.fontSize ?? (item.kind === 'text' ? 20 : item.kind === 'frame' ? 12 : 16);
	const insetX = item.kind === 'shape' ? item.width * 0.18 : item.kind === 'frame' ? 0 : 18;
	const insetY = item.kind === 'shape' ? item.height * 0.18 : 18;
	const alignment = item.textAlign ?? (item.kind === 'shape' ? 'center' : 'left');
	const vertical = item.verticalAlign ?? (item.kind === 'shape' ? 'middle' : 'top');
	const contentWidth = Math.max(1, item.width - insetX * 2);
	// SVG has no native wrapping. Approximate the browser line width and preserve explicit newlines.
	const maxChars = Math.max(1, Math.floor(contentWidth / (fontSize * 0.58)));
	const lines = item.text.split('\n').flatMap(line => {
		const wrapped: string[] = []; let rest = line;
		while (rest.length > maxChars) { const space = rest.lastIndexOf(' ', maxChars); const at = space > 0 ? space : maxChars; wrapped.push(rest.slice(0, at)); rest = rest.slice(at).trimStart(); }
		return [...wrapped, rest];
	});
	const lineHeight = fontSize * 1.4; const blockHeight = lines.length * lineHeight;
	const textX = alignment === 'center' ? item.width / 2 : alignment === 'right' ? item.width - insetX : insetX;
	const textY = item.kind === 'frame' ? -12 : (vertical === 'middle' ? (item.height - blockHeight) / 2 : vertical === 'bottom' ? item.height - insetY - blockHeight : insetY) + fontSize;
	const family = item.fontFamily === 'serif' ? 'Georgia, serif' : item.fontFamily === 'mono' ? 'Consolas, monospace' : 'Mona Sans, Segoe UI, sans-serif';
	const colour = item.textColor ?? (item.kind === 'text' || item.kind === 'frame' ? '#203049' : shapeTextColor(fill));
	const border = escape(item.strokeColor ?? (item.kind === 'shape' ? '#7565bd' : '#b8c6dc'));
	const strokeWidth = item.strokeWidth ?? (item.kind === 'shape' ? 1.5 : 1);
	const dash = shapeStrokeDash(item.strokeStyle ?? (item.kind === 'frame' ? 'dashed' : 'solid'), strokeWidth);
	const geometry = item.kind === 'shape' ? `<svg width="${item.width}" height="${item.height}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${shapeDefinition(item.shape).path}" fill="${escape(fill)}" stroke="${border}" stroke-width="${strokeWidth}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>` : `<rect width="${item.width}" height="${item.height}" rx="${item.kind === 'frame' ? 8 : 0}" fill="${escape(fill)}" stroke="${item.kind === 'text' ? 'none' : border}" stroke-width="${strokeWidth}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
	return `<g data-element="${escape(item.id)}" aria-label="${escape(item.text)}" transform="translate(${x},${y})" opacity="${item.opacity ?? 1}">${geometry}<text x="${textX}" y="${textY}" text-anchor="${alignment === 'center' ? 'middle' : alignment === 'right' ? 'end' : 'start'}" fill="${escape(colour)}" font-family="${family}" font-size="${fontSize}" font-weight="${item.bold ? 700 : 400}" font-style="${item.italic ? 'italic' : 'normal'}" text-decoration="${item.underline ? 'underline' : 'none'}">${lines.map((line, index) => `<tspan x="${textX}" dy="${index ? lineHeight : 0}">${escape(line)}</tspan>`).join('')}</text></g>`;
}

/** Export the presentation projection, independent of viewport, panels or active mode. */
export async function presentationSvg(architecture: Architecture): Promise<string> {
 const points = [...architecture.resources.map(resource => isResourceContainer(resource)?{...resource.positions.visual,...resourceDimensions(architecture,resource,'visual')}:{ x:resource.positions.visual.x+resourceIconSize(resource)/2-70,y:resource.positions.visual.y,width:140,height:resourceIconSize(resource)+44 }), ...architecture.items.map(item => ({ ...item.positions.visual, width: item.width, height: item.height }))];
 const x = Math.min(0, ...points.map(point => point.x)) - 40;
 const y = Math.min(0, ...points.map(point => point.y)) - 70;
 const width = Math.max(400, ...points.map(point => point.x + point.width)) - x + 40;
 const height = Math.max(300, ...points.map(point => point.y + point.height)) - y + 40;
 const icons = await Promise.all(architecture.resources.map(async resource => {
  const graphic = resource.iconKind ? resourceDefinition({ kind: resource.iconKind, provider: resource.provider }) : resourceDefinition(resource);
  const response = await fetch('./assets/' + graphic.icon);
  if (!response.ok) { throw new Error('Unable to load export icon'); }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
 }));
 const drawings = new Map(architecture.items.map(item => [item.id, drawingMarkup(item)]));
 const edges = architecture.connections.map((edge, index) => {
  const source = connectionAnchor(architecture, edge.source, 'source', 'visual'); const target = connectionAnchor(architecture, edge.target, 'target', 'visual');
  if (!source || !target) { return ''; }
  const [path, labelX, labelY] = connectionPath(edge, source.x, source.y, target.x, target.y);
  const colour = escape(edge.stroke ?? '#7565bd'); const dash = connectionDash(edge);
  return `<g><defs><marker id="connection-arrow-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/></marker></defs><path d="${path}" stroke="${colour}" stroke-width="${edge.width ?? 1.5}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" fill="none" ${edge.startArrow ? `marker-start="url(#connection-arrow-${index})"` : ''} ${edge.endArrow === false ? '' : `marker-end="url(#connection-arrow-${index})"`}/>${edge.label ? `<text x="${labelX}" y="${labelY + (edge.labelPosition === 'above' ? -18 : edge.labelPosition === 'below' ? 18 : 0)}" text-anchor="middle" dominant-baseline="middle" font-size="${edge.labelFontSize ?? 11}" fill="${escape(edge.labelColor ?? '#203049')}">${escape(edge.label)}</text>` : ''}</g>`;
 }).join('');
 const resources = new Map(architecture.resources.map((resource, index) => { const size = resourceIconSize(resource); const bounds=resourceDimensions(architecture,resource,'visual');return [resource.id, `<g data-element="${escape(resource.id)}" transform="translate(${resource.positions.visual.x},${resource.positions.visual.y})">${isResourceContainer(resource)?`<rect width="${bounds.width}" height="${bounds.height}" rx="8" fill="#f8faff" fill-opacity="0.3" stroke="#b8c6dc"/><rect width="${bounds.width}" height="44" rx="8" fill="white" stroke="#b8c6dc"/><image href="${icons[index]}" x="12" y="11" width="22" height="22"/><text x="42" y="27" font-size="12">${escape(resource.label||resource.name)} · ${escape(resourceDefinition(resource).label)}</text>`:`<image href="${icons[index]}" width="${size}" height="${size}"/><text x="${size/2}" y="${size+20}" text-anchor="middle" font-size="11">${escape(resource.label || resource.name)}</text>`}</g>`]; }));
 const frames = new Set([...architecture.items.filter(item => item.kind === 'frame').map(item => item.id),...architecture.resources.filter(isResourceContainer).map(item=>item.id)]);
 const order = sceneOrder(architecture);
 const items = order.filter(id => frames.has(id)).map(id => drawings.get(id)??resources.get(id)??'').join('');
 const nodes = order.filter(id => !frames.has(id)).map(id => drawings.get(id) ?? resources.get(id) ?? '').join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family="Segoe UI, sans-serif" fill="#203049"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7565bd"/></marker></defs><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/><text x="${x + 20}" y="${y + 30}" font-size="20">${escape(architecture.name)}</text>${items}${edges}${nodes}</svg>`;
}

export async function exportPresentation(architecture: Architecture, format: 'svg' | 'png' | 'pdf') {
 // Open print window during the user gesture, before awaiting icon loading.
 const printWindow = format === 'pdf' ? window.open('', '_blank') : null;
 try {
  const svg = await presentationSvg(architecture);
  if (format === 'pdf') {
   if (!printWindow) { throw new Error('Allow the print window to save a PDF.'); }
   printWindow.document.write(`<html><head><title>CloudForge Architecture</title><style>@page{size:landscape;margin:10mm}body{margin:0}svg{width:100%;height:90vh}</style></head><body>${svg}</body></html>`);
   printWindow.document.close(); printWindow.focus(); printWindow.print(); return;
  }
  let blob = new Blob([svg], { type: 'image/svg+xml' });
  if (format === 'png') {
   const url = URL.createObjectURL(blob);
   try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(2, 8192 / Math.max(image.width, image.height));
    canvas.width = Math.ceil(image.width * scale); canvas.height = Math.ceil(image.height * scale);
    const context = canvas.getContext('2d'); if (!context) { throw new Error('PNG canvas unavailable'); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
   } finally { URL.revokeObjectURL(url); }
  }
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'cloudforge-architecture.' + format; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
 } catch (error) { printWindow?.close(); window.alert(error instanceof Error ? error.message : 'Export failed'); }
}
