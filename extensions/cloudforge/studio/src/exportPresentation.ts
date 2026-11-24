import { shapeDefinition, shapeTextColor, shapeStrokeDash } from './shapes.ts';
import { connectionPath, connectionDash } from './connectionGeometry.ts';
import { connectionAnchor } from './designConnections.ts';
import type { Architecture } from './model.ts';
import { resourceDefinition } from './fixture.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

/** Export the presentation projection, independent of viewport, panels or active mode. */
export async function presentationSvg(architecture: Architecture): Promise<string> {
 const points = [...architecture.resources.map(resource => ({ ...resource.positions.visual, width: 150, height: 100 })), ...architecture.items.map(item => ({ ...item.positions.visual, width: item.width, height: item.height }))];
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
 const items = architecture.items.map(item => {
  const { x, y } = item.positions.visual;
  if (item.kind === 'shape') {
   const fill = item.fill ?? '#eef2ff';
   return `<g transform="translate(${x},${y})"><svg width="${item.width}" height="${item.height}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${shapeDefinition(item.shape).path}" fill="${escape(fill)}" stroke="${escape(item.strokeColor ?? '#7565bd')}" stroke-width="${item.strokeWidth ?? 1.5}" ${item.strokeStyle && item.strokeStyle !== 'solid' ? `stroke-dasharray="${shapeStrokeDash(item.strokeStyle, item.strokeWidth)}"` : ''} stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg><text x="${item.width / 2}" y="${item.height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${shapeTextColor(fill)}" font-size="${item.fontSize ?? 14}" font-weight="${item.bold ? 700 : 400}">${escape(item.text)}</text></g>`;
  }
  return `<g><rect x="${x}" y="${y}" width="${item.width}" height="${item.height}" rx="8" fill="${escape(item.fill ?? (item.kind === 'note' ? '#fff0b5' : item.kind === 'frame' ? '#f7faff' : '#ffffff'))}" stroke="#b8c6dc"/><text x="${x + 12}" y="${y + 24}" font-size="${item.fontSize ?? 13}" font-weight="${item.bold ? 700 : 400}">${escape(item.text)}</text></g>`;
 }).join('');
 const edges = architecture.connections.map((edge, index) => {
  const source = connectionAnchor(architecture, edge.source, 'source', 'visual'); const target = connectionAnchor(architecture, edge.target, 'target', 'visual');
  if (!source || !target) { return ''; }
  const [path, labelX, labelY] = connectionPath(edge, source.x, source.y, target.x, target.y);
  const colour = escape(edge.stroke ?? '#7565bd'); const dash = connectionDash(edge);
  return `<g><defs><marker id="connection-arrow-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/></marker></defs><path d="${path}" stroke="${colour}" stroke-width="${edge.width ?? 1.5}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" fill="none" ${edge.startArrow ? `marker-start="url(#connection-arrow-${index})"` : ''} ${edge.endArrow === false ? '' : `marker-end="url(#connection-arrow-${index})"`}/>${edge.label ? `<text x="${labelX}" y="${labelY - 8}" text-anchor="middle" font-size="11">${escape(edge.label)}</text>` : ''}</g>`;
 }).join('');
 const nodes = architecture.resources.map((resource, index) => `<g transform="translate(${resource.positions.visual.x},${resource.positions.visual.y})"><image href="${icons[index]}" x="28" y="0" width="40" height="40"/><text x="48" y="60" text-anchor="middle" font-size="12">${escape(resource.label || resource.name)}</text></g>`).join('');
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
