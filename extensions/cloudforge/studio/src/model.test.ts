import { elementEndpoint, endpointElementId } from './connectionEndpoints.ts';
import { applyTerraformDraft, terraformCode } from './terraformProjection.ts';
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { importVariableDraft, exportableArchitecture, objectVariablePaths, variableDeclarations, variableError, variableUses, type VariableDefinition } from './variables.ts';
import { acceptsVariable } from './fieldBindings.ts';
import type { BoardItem } from './model.ts';
import { presentationSvg } from './exportPresentation.ts';
import { shapeDefinitions } from './shapes.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistory, historyReducer, checkDraft } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { additionalBlocks, blockDefinitions, fieldIssue, resourceFormIssues } from './formDefinition.ts';
import { connectionDash, connectionPath } from './connectionGeometry.ts';
import { canConnect, connectionAnchor, connectableElements } from './designConnections.ts';
import { applyCanvasCommand, expandGroups, sceneOrder, selectionFragment } from './canvasOperations.ts';
import { layoutSelection, selectionUnits } from './selectionGeometry.ts';
import type { Architecture, Action } from './model.ts';
import { bindingKey, variableBindingIssue, variablePreview, type FieldTarget } from './fieldBindings.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { alignmentGuides } from './alignmentGuides.ts';
import { inheritedReferences, resourcePlacement, resourceDimensions, resourceDescendants } from './resourceHierarchy.ts';
import { architectureDiagnostics } from './diagnostics.ts';
import { projectTerraform } from './terraformProjection.ts';
import { workflowTemplate } from './workflowTemplate.ts';
import { parseVariableInput, variableInputIssue } from './variableInputs.ts';

function framedArchitecture():Architecture {
	const sample=sampleArchitecture();
	return {...sample,resources:sample.resources.map(resource=>({...resource,parentId:undefined})),items:sample.items.map((item,index)=>index?item:{...item,positions:{visual:{x:20,y:65},technical:{x:20,y:65}},members:['network','subnet']})};
}

test('alignment guides use a six screen pixel tolerance and never mutate source geometry', () => {
	const boxes = [{id:'moving',x:95,y:200,width:40,height:40},{id:'target',x:100,y:10,width:40,height:40}];
	const before = JSON.stringify(boxes);
	assert.equal(alignmentGuides(boxes,['moving'],1).dx,5);
	assert.equal(alignmentGuides(boxes,['moving'],2).dx,0);
	assert.equal(alignmentGuides(boxes,['moving'],0.5).lines.length,1);
	assert.equal(JSON.stringify(boxes),before);
});

test('group guide geometry uses the selection bounds and excludes moving descendants and parent containers', () => {
	const boxes = [{id:'frame',x:0,y:0,width:300,height:300},{id:'a',parentId:'frame',x:20,y:20,width:40,height:40},{id:'b',parentId:'frame',x:100,y:20,width:40,height:40},{id:'other',x:5,y:600,width:300,height:300}];
	const result = alignmentGuides(boxes,['frame','a','b'],1);
	assert.deepEqual([...result.roots],['frame']);
	assert.equal(result.dx,5);
	const child = alignmentGuides(boxes.slice(0,2),['a'],1);
	assert.deepEqual(child.lines,[]);
	const pair = alignmentGuides([{id:'a',x:5,y:5,width:10,height:10},{id:'b',x:25,y:5,width:10,height:10},{id:'c',x:10,y:200,width:30,height:10}],['a','b'],1);
	assert.equal(pair.dx,5);
	assert.deepEqual([...pair.roots],['a','b']);
});

test('alignment guides ignore invalid bounds and select the nearest candidate', () => {
	const result = alignmentGuides([{id:'a',x:10,y:10,width:40,height:40},{id:'farther',x:15,y:200,width:40,height:40},{id:'nearer',x:12,y:300,width:40,height:40},{id:'invalid',x:NaN,y:9,width:40,height:40}],['a'],1);
	assert.equal(result.dx,2);
	assert.ok(result.lines.every(line=>Object.values(line).every(Number.isFinite)));
	assert.deepEqual(alignmentGuides([],['missing'],1).lines,[]);
});

test('resource icon resize shares its origin across views and changes icon/port geometry in one undo without changing configuration', () => {
	const architecture = sampleArchitecture(); const before = architecture.resources.find(resource=>resource.id==='storage')!;
	const history = historyReducer(createHistory(architecture),{type:'resizeResource',id:before.id,iconSize:96,position:{x:before.positions.visual.x-48,y:before.positions.visual.y-48}});
	const resource = history.present.resources.find(item=>item.id===before.id)!;
	assert.equal(resourceIconSize(resource),96);
	assert.deepEqual(resource.positions.technical,resource.positions.visual);
	assert.equal(terraformCode(history.present),terraformCode(architecture));
	assert.deepEqual(resource.settings,before.settings); assert.deepEqual(resource.blocks,before.blocks);
	assert.deepEqual(connectionAnchor(history.present,before.id,'source','visual'),{x:resource.positions.visual.x+96,y:resource.positions.visual.y+48});
	assert.equal(history.past.length,1); assert.deepEqual(historyReducer(history,{type:'undo'}).present,architecture);
	for(const iconSize of [NaN,0,161]) { assert.equal(historyReducer(history,{type:'resizeResource',id:before.id,iconSize,position:before.positions.visual}),history); }
	const locked = createHistory(applyCanvasCommand(architecture,{kind:'lock',ids:[before.id],locked:true}));
	assert.equal(historyReducer(locked,{type:'resizeResource',id:before.id,iconSize:96,position:before.positions.visual}),locked);
});

test('typed variable bindings project names and regions as expressions and undo preserves the literal values', () => {
	const architecture = {...sampleArchitecture(),variables:[{id:'input-location',name:'location',type:'string' as const,description:'Region',sensitive:false,defaultValue:'uksouth'}]};
	const initial=createHistory(architecture);
	const bound=historyReducer(initial,{type:'bindVariable',id:'network',target:{kind:'region'},variableId:'input-location'});
	assert.ok(/location\s*=\s*var\.location/.test(terraformCode(bound.present,'network')));
	assert.equal(bound.present.resources.find(item=>item.id==='network')!.region,'UK South');
	assert.ok(variableUses(bound.present).get('location')?.has('network'));
	assert.equal(historyReducer(bound,{type:'deleteVariable',id:'input-location'}),bound);
	assert.deepEqual(historyReducer(bound,{type:'undo'}).present,architecture);
	const unbound=historyReducer(bound,{type:'bindVariable',id:'network',target:{kind:'region'}});
	assert.ok(/location\s*=\s*"uksouth"/.test(terraformCode(unbound.present,'network')));
	const named=historyReducer(bound,{type:'bindVariable',id:'network',target:{kind:'name'},variableId:'input-location'});
	assert.ok(/name\s*=\s*var\.location/.test(terraformCode(named.present,'network')));
	assert.ok(terraformCode(named.present,'network').includes('"vnet-production"'));
});

test('variable selection enforces declared field types and sensitive previews never expose the value', () => {
	const numberVariable={id:'count',name:'count',type:'number' as const,description:'',sensitive:false,defaultValue:0};
	const secret={id:'secret',name:'secret',type:'string' as const,description:'',sensitive:true,defaultValue:'do-not-render'};
	const architecture={...sampleArchitecture(),variables:[numberVariable,secret]};
	const initial=createHistory(architecture);
	assert.equal(historyReducer(initial,{type:'bindVariable',id:'network',target:{kind:'region'},variableId:numberVariable.id}),initial);
	assert.equal(historyReducer(initial,{type:'bindVariable',id:'network',target:{kind:'region'},variableId:'missing'}),initial);
	assert.equal(variableBindingIssue({variableId:'missing'},architecture.variables,{type:'string'}),'The bound variable is missing. Choose another variable or a fixed value.');
	assert.equal(variablePreview(numberVariable),'0'); assert.equal(variablePreview(secret),'Sensitive value');
	assert.equal(variablePreview({...secret,sensitive:false},true),'Sensitive value');
	assert.equal(variablePreview({...numberVariable,type:'bool',value:false}),'false');
});

test('a schema field with no literal value can bind an input and materializes atomically for Terraform', () => {
	const architecture = {...sampleArchitecture(),variables:[{id:'group-input',name:'resource_group',type:'string' as const,description:'',sensitive:false}]};
	const initial = createHistory(architecture);
	const bound = historyReducer(initial,{type:'bindVariable',id:'network',target:{kind:'setting',name:'resource_group_name'},variableId:'group-input'});
	assert.equal(bound.past.length,1);
	assert.equal(bound.present.resources.find(item=>item.id==='network')!.settings.resource_group_name,'');
	assert.match(terraformCode(bound.present,'network'),/resource_group_name\s*=\s*var\.resource_group/);
	assert.deepEqual(historyReducer(bound,{type:'undo'}).present,architecture);
	assert.equal(historyReducer(initial,{type:'bindVariable',id:'network',target:{kind:'setting',name:'invented_attribute'},variableId:'group-input'}),initial);
});

test('nested field bindings survive sibling edits, clone with block IDs and release variable usage when the block is removed', () => {
	const resource=sampleArchitecture().resources.find(item=>item.id==='network')!;
	resource.blocks=[{id:'nested-block',type:'subnet',values:{name:'snet',address_prefix:'10.0.0.0/24'},blocks:[]}];
	const architecture:Architecture={name:'Binding',resources:[resource],items:[],connections:[],variables:[{id:'subnet-input',name:'subnet_name',type:'string',description:'',sensitive:false}]};
	const target:FieldTarget={kind:'block',blockId:'nested-block',name:'name'};
	const bound=historyReducer(createHistory(architecture),{type:'bindVariable',id:resource.id,target,variableId:'subnet-input'});
	assert.ok(terraformCode(bound.present,resource.id).includes('var.subnet_name'));
	const cloned=applyCanvasCommand(bound.present,{kind:'duplicate',fragment:selectionFragment(bound.present,[resource.id]),idMap:{[resource.id]:'clone'},offset:30});
	assert.ok(cloned.resources[1].fieldBindings?.[bindingKey({...target,blockId:'clone:nested-block'})]);
	assert.ok(terraformCode(cloned,'clone').includes('var.subnet_name'));
	const removed=historyReducer(bound,{type:'update',id:resource.id,patch:{blocks:[]}});
	assert.equal(Object.keys(removed.present.resources[0].fieldBindings??{}).length,0);
	assert.equal(variableUses(removed.present).has('subnet_name'),false);
});

test('explicit sensitive-variable bindings override generated placeholder names and never export a sensitive default', () => {
	const resource={...sampleArchitecture().resources[0],kind:'compute' as const,settings:{admin_password:'local-literal'}};
	const architecture:Architecture={name:'Secret binding',resources:[resource],items:[],connections:[],variables:[{id:'secret',name:'vm_password',type:'string',description:'',sensitive:true,defaultValue:'never-export-me'}]};
	const bound=historyReducer(createHistory(architecture),{type:'bindVariable',id:resource.id,target:{kind:'setting',name:'admin_password'},variableId:'secret'});
	const code=terraformCode(bound.present,resource.id);
	assert.ok(code.includes('var.vm_password')); assert.ok(!code.includes('local-literal'));
	assert.ok(!JSON.stringify(exportableArchitecture(bound.present)).includes('never-export-me'));
	const changed=code.replace('var.vm_password','"changed-literal"');
	assert.throws(()=>applyTerraformDraft(bound.present,changed,resource.id),/type|contract|form|represented/i);
});

function drawing(id: string, x: number, y = 100): BoardItem {
	return { id, kind: 'shape', shape: 'rectangle', text: id, width: 200, height: 100, members: [], positions: { visual: { x, y }, technical: { x: x + 50, y: y + 100 } } };
}

test('batch moves apply a selected frame delta once to absolute child positions and undo once', () => {
	const architecture = framedArchitecture();
	const frame = architecture.items.find(item => item.members.length)!;
	const child = architecture.resources.find(resource => resource.id === frame.members[0])!;
	const positions = Object.fromEntries([frame, child].map(item => [item.id, { x: item.positions.visual.x + 45, y: item.positions.visual.y - 20 }]));
	const initial = createHistory(architecture);
	const moved = historyReducer(initial, { type: 'canvas', command: { kind: 'move', mode: 'visual', positions } });
	assert.equal(moved.present.resources.find(item => item.id === child.id)!.positions.visual.x, child.positions.visual.x + 45);
	assert.deepEqual(moved.present.resources.find(item => item.id === child.id)!.positions.technical, moved.present.resources.find(item=>item.id===child.id)!.positions.visual);
	assert.equal(moved.past.length, 1);
	assert.deepEqual(historyReducer(moved, { type: 'undo' }).present, architecture);
});

test('visual groups preserve provider configuration and both layouts through grouping and release', () => {
	const architecture = { ...sampleArchitecture(), items: [drawing('a', 0), drawing('b', 300)] };
	const before = JSON.stringify(architecture.resources);
	const grouped = applyCanvasCommand(architecture, { kind: 'group', ids: ['a', 'b'], id: 'visual-group' });
	assert.deepEqual(expandGroups(grouped, ['a']), ['a', 'b']);
	assert.deepEqual(selectionUnits(grouped, ['b']), [['b', 'a']]);
	assert.equal(JSON.stringify(grouped.resources), before);
	assert.deepEqual(grouped.items, architecture.items);
	const released = applyCanvasCommand(grouped, { kind: 'ungroup', ids: ['a'] });
	assert.deepEqual(released.groups, []);
	assert.deepEqual(released.items, architecture.items);
});

test('canvas locks guard movement, drawing edits, resizing, styling and deletion without consuming undo', () => {
	const architecture = { ...sampleArchitecture(), items: [drawing('a', 0)] };
	let history = createHistory(applyCanvasCommand(architecture, { kind: 'lock', ids: ['a', 'network'], locked: true }));
	for (const action of [
		{ type: 'canvas', command: { kind: 'move', mode: 'visual', positions: { a: { x: 800, y: 900 }, network: { x: 800, y: 900 } } } },
		{ type: 'canvas', command: { kind: 'style', ids: ['a'], patch: { bold: true } } },
		{ type: 'updateItem', id: 'a', patch: { text: 'blocked' } },
		{ type: 'resizeItem', id: 'a', mode: 'visual', position: { x: 0, y: 0 }, width: 400, height: 400 },
		{ type: 'canvas', command: { kind: 'delete', ids: ['a', 'network'] } }
	] satisfies Action[]) { assert.equal(historyReducer(history, action), history); }
	const edited = historyReducer(history, { type: 'update', id: 'network', patch: { name: 'configuration-still-editable' } });
	assert.equal(edited.present.resources.find(item => item.id === 'network')!.name, 'configuration-still-editable');
	history = historyReducer(history, { type: 'canvas', command: { kind: 'lock', ids: ['a'], locked: false } });
	assert.equal(history.present.items[0].canvasLocked, false);
});

test('batch formatting is atomic, skips locked drawings and rejects invalid appearance values', () => {
	const architecture: Architecture = { name: 'Drawing', resources: [], connections: [], items: [drawing('a', 0), { ...drawing('b', 300), canvasLocked: true }] };
	const history = createHistory(architecture);
	const styled = historyReducer(history, { type: 'canvas', command: { kind: 'style', ids: ['a', 'b'], patch: { fontFamily: 'serif', fontSize: 32, italic: true, underline: true, opacity: 0.5, textAlign: 'right' } } });
	assert.equal(styled.past.length, 1);
	assert.equal(styled.present.items[0].fontFamily, 'serif');
	assert.deepEqual(styled.present.items[1], architecture.items[1]);
	assert.deepEqual(historyReducer(styled, { type: 'undo' }).present, architecture);
	for (const patch of [{ fontSize: NaN }, { strokeWidth: -3 }, { opacity: 2 }, { textColor: '<script>' }]) {
		assert.equal(applyCanvasCommand(architecture, { kind: 'style', ids: ['a'], patch }), architecture);
	}
});

test('copying a frame preserves internal links, remaps stable IDs and nested blocks and leaves the source intact', () => {
	const architecture = framedArchitecture(); const frame = architecture.items.find(item => item.members.length)!;
	architecture.resources.find(item => item.id === frame.members[0])!.blocks = [{ id: 'block', type: 'example', values: { value: 'preserved' }, blocks: [{ id: 'nested', type: 'nested', values: {}, blocks: [] }] }];
	const fragment = selectionFragment(architecture, [frame.id]); const before = JSON.stringify(architecture);
	const idMap = Object.fromEntries([...fragment.items, ...fragment.resources].map(item => [item.id, 'clone-' + item.id]));
	const cloned = applyCanvasCommand(architecture, { kind: 'duplicate', fragment, idMap, offset: 30 });
	assert.equal(JSON.stringify(architecture), before);
	assert.deepEqual(cloned.items.at(-1)!.members, frame.members.map(id => idMap[id]));
	assert.equal(cloned.resources.at(-fragment.resources.length)!.positions.visual.x, fragment.resources[0].positions.visual.x + 30);
	assert.ok(cloned.resources.at(-fragment.resources.length)!.blocks[0].blocks[0].id.startsWith('clone-'));
	assert.equal(cloned.connections.length, architecture.connections.length + fragment.connections.length);
	assert.ok(cloned.connections.slice(architecture.connections.length).every(link => endpointElementId(link.source)!.startsWith('clone-') && endpointElementId(link.target)!.startsWith('clone-')));
	assert.equal(new Set(cloned.resources.map(resource => resource.name)).size, cloned.resources.length);
	assert.ok(cloned.resources.every(resource => !resource.terraformName || /^[A-Za-z_][A-Za-z0-9_-]*$/.test(resource.terraformName)));
});

test('alignment uses grouped bounds and distribution keeps the outer objects anchored', () => {
	const architecture: Architecture = { name: 'Layout', resources: [], connections: [], items: [drawing('a', 0, 80), drawing('b', 300, 200), drawing('c', 900, 400)] };
	const sizes = { a: { width: 200, height: 100 }, b: { width: 100, height: 100 }, c: { width: 200, height: 100 } };
	const ids = ['a', 'b', 'c'];
	const top = layoutSelection(architecture, ids, 'visual', 'top', sizes);
	assert.ok(Object.values(top).every(position => position.y === 80));
	const spaced = layoutSelection(architecture, ids, 'visual', 'horizontal', sizes);
	assert.equal(spaced.a.x, 0); assert.equal(spaced.c.x, 900); assert.equal(spaced.b.x, 500);
	const grouped = applyCanvasCommand(architecture, { kind: 'group', ids: ['a', 'b'], id: 'g' });
	const aligned = layoutSelection(grouped, ids, 'visual', 'right', sizes);
	assert.equal(aligned.b.x - aligned.a.x, 300);
	assert.equal(aligned.b.y - aligned.a.y, 120);
});

test('layer commands preserve frame backgrounds and export drawing order and typography', async () => {
	const architecture: Architecture = { name: 'Layers', resources: [], connections: [], items: [{ ...drawing('frame', 0), kind: 'frame' }, drawing('a', 0), { ...drawing('b', 0), text: 'First <line>\nSecond & line', italic: true, underline: true, fontFamily: 'serif', textAlign: 'right', verticalAlign: 'bottom', opacity: 0.5, textColor: '#123456' }] };
	const arranged = applyCanvasCommand(architecture, { kind: 'arrange', ids: ['a'], direction: 'front' });
	assert.deepEqual(sceneOrder(arranged), ['frame', 'b', 'a']);
	const svg = await presentationSvg(arranged);
	assert.ok(svg.indexOf('data-element="frame"') < svg.indexOf('data-element="b"'));
	assert.ok(svg.indexOf('data-element="b"') < svg.indexOf('data-element="a"'));
	assert.ok(svg.includes('font-style="italic"') && svg.includes('text-decoration="underline"') && svg.includes('text-anchor="end"'));
	assert.ok(svg.includes('opacity="0.5"') && svg.includes('fill="#123456"') && svg.includes('Georgia, serif'));
	assert.ok(svg.includes('First &lt;line&gt;') && svg.includes('Second &amp; line'));
	assert.ok(!svg.includes('First <line>'));
});

test('connection direction reversal and label formatting share history and export without changing configuration', async () => {
	const architecture: Architecture = { name: 'Links', resources: [], items: [drawing('a', 0), drawing('b', 400)], connections: [{ id: 'link', source: elementEndpoint('a'), target: elementEndpoint('b'), endArrow: true }] };
	const styled = historyReducer(createHistory(architecture), { type: 'updateConnection', id: 'link', patch: { label: 'traffic', labelFontSize: 20, labelColor: '#123456', labelPosition: 'above' } });
	const reversed = historyReducer(styled, { type: 'reverseConnection', id: 'link' });
	assert.equal(reversed.present.connections[0].id, 'link');
	assert.equal(endpointElementId(reversed.present.connections[0].source), 'b');
	assert.equal(endpointElementId(reversed.present.connections[0].target), 'a');
	assert.equal(reversed.present.connections[0].endArrow, true);
	assert.deepEqual(historyReducer(reversed, { type: 'undo' }).present, styled.present);
	const svg = await presentationSvg(reversed.present);
	assert.ok(svg.includes('font-size="20" fill="#123456">traffic'));
	assert.deepEqual(reversed.present.items, architecture.items);
	const duplicate = createHistory({ ...architecture, connections: [...architecture.connections, { id: 'other', source: elementEndpoint('b'), target: elementEndpoint('a') }] });
	assert.equal(historyReducer(duplicate, { type: 'reverseConnection', id: 'link' }), duplicate);
	assert.equal(historyReducer(styled, { type: 'updateConnection', id: 'link', patch: { labelFontSize: NaN } }), styled);
});

test('drawings connect by stable IDs and delete with attached links in one undo step', () => {
	const shape = (id: string, x: number): BoardItem => ({ id, kind: 'shape', text: id, shape: 'rectangle', width: 200, height: 100, members: [], positions: { visual: { x, y: 100 }, technical: { x, y: 200 } } });
	const architecture = { ...sampleArchitecture(), items: [shape('a', 50), shape('b', 400)] };
	const initial = createHistory(architecture);
	const connected = historyReducer(initial, { type: 'connect', source: 'a', target: 'b' });
	assert.equal(connected.present.connections.length, initial.present.connections.length + 1);
	assert.equal(canConnect(connected.present, 'a', 'b'), false);
	assert.ok(canConnect(connected.present, 'a', 'network'));
	assert.equal(canConnect(connected.present, 'a', 'a'), false);
	const moved = historyReducer(connected, { type: 'moveItem', id: 'a', mode: 'visual', position: { x: 75, y: 125 } });
	assert.deepEqual(connectionAnchor(moved.present, 'a', 'source', 'visual'), { x: 275, y: 175 });
	assert.deepEqual(connectionAnchor(moved.present, 'a', 'source', 'technical'), { x: 275, y: 175 });
	const resized = historyReducer(moved, { type: 'resizeItem', id: 'a', mode: 'visual', position: { x: 75, y: 125 }, width: 300, height: 120 });
	assert.deepEqual(connectionAnchor(resized.present, 'a', 'source', 'visual'), { x: 375, y: 185 });
	assert.deepEqual(resized.present.connections, moved.present.connections);
	const deleted = historyReducer(moved, { type: 'deleteItem', id: 'a' });
	assert.equal(deleted.past.length, moved.past.length + 1);
	assert.ok(!deleted.present.connections.some(link => endpointElementId(link.source) === 'a' || endpointElementId(link.target) === 'a'));
	assert.deepEqual(historyReducer(deleted, { type: 'undo' }).present, moved.present);
	assert.ok(!connectableElements(sampleArchitecture()).some(element => sampleArchitecture().items.some(item => item.kind === 'frame' && item.id === element.id)));
});

test('drawing connectors retain geometry and escaped labels in presentation export', async () => {
	const item = (id: string, x: number): BoardItem => ({ id, kind: 'note', text: id, width: 200, height: 100, members: [], positions: { visual: { x, y: 100 }, technical: { x, y: 200 } } });
	const svg = await presentationSvg({ name: 'Drawing flow', resources: [], items: [item('a', 50), item('b', 400)], connections: [{ id: 'a-b', source: elementEndpoint('a'), target: elementEndpoint('b'), routing: 'straight', label: '<Review>' }] });
	assert.ok(svg.includes('M 250,150L 400,150') || svg.includes('M250,150L400,150') || svg.includes('M 250 150L 400 150'), svg);
	assert.ok(svg.includes('&lt;Review&gt;'));
});

test('connection appearance and deletion use shared history without changing Terraform configuration', () => {
	const initial = createHistory(sampleArchitecture()); const id = initial.present.connections[0].id;
	const updated = historyReducer(initial, { type: 'updateConnection', id, patch: { label: 'HTTPS', routing: 'curve', pattern: 'dotted', width: 3, startArrow: true, endArrow: false } });
	assert.equal(updated.past.length, 1); assert.equal(updated.present.connections[0].routing, 'curve');
	assert.equal(connectionDash(updated.present.connections[0]), '3 9');
	assert.equal(terraformCode(updated.present), terraformCode(initial.present));
	assert.deepEqual(historyReducer(updated, { type: 'undo' }).present, initial.present);
	assert.equal(historyReducer(updated, { type: 'updateConnection', id, patch: { width: 3 } }), updated);
	assert.equal(historyReducer(updated, { type: 'updateConnection', id, patch: { width: NaN } }), updated);
	const deleted = historyReducer(updated, { type: 'deleteConnection', id });
	assert.equal(deleted.present.connections.length, initial.present.connections.length - 1);
	assert.deepEqual(historyReducer(deleted, { type: 'undo' }).present, updated.present);
});

test('connection geometry uses distinct straight, elbow and curve projections', () => {
	const connection = { id: 'link', source: elementEndpoint('a'), target: elementEndpoint('b') };
	const paths = (['straight','elbow','curve'] as const).map(routing => connectionPath({ ...connection, routing }, 0, 0, 200, 100)[0]);
	assert.equal(new Set(paths).size, 3); assert.ok(paths[2].includes('C'));
	assert.equal(connectionDash(connection), undefined);
});

test('node form findings derive from current nested block values and clear with correction', () => {
	const network = sampleArchitecture().resources[0];
	const resource = { ...network, kind: 'generic' as const, catalogue: { type: 'azurerm_linux_virtual_machine', label: 'VM', service: 'Compute', category: 'Compute', icon: '', fields: [] }, blocks: [{ id: 'disk', type: 'os_disk', values: { caching: '', storage_account_type: 'Standard_LRS' }, blocks: [] }] };
	assert.ok(resourceFormIssues(resource).some(issue => issue.includes('caching: Required value')));
	assert.equal(resourceFormIssues({ ...resource, blocks: [{ ...resource.blocks[0], values: { ...resource.blocks[0].values, caching: 'ReadOnly' } }] }).some(issue => issue.startsWith('os_disk')), false);
});

test('nested schema preserves required flags, recursive cardinality and typed defaults', () => {
	const blocks = blockDefinitions([{ name: 'pool', type: 'block', required: true, repeat: true, description: 'Pool', children: [
		{ name: 'enabled', type: 'bool', default: false, description: 'Enabled' },
		{ name: 'size', type: 'number', default: 0, description: 'Size' },
		{ name: 'optional', type: 'string', description: 'Optional' },
		{ name: 'child', type: 'block', description: 'Child', children: [] }
	] }]);
	assert.equal(blocks[0].required, true); assert.equal(blocks[0].max, Infinity);
	assert.deepEqual(blocks[0].fields, { enabled: 'false', size: '0' });
	assert.equal(blocks[0].children[0].max, 1);
	assert.deepEqual(blocks[0].children[0].fields, {});
});

test('local nested field checks distinguish absence from false and zero', () => {
	const attr = { name: 'value', required: true, description: '' };
	assert.equal(fieldIssue('', { ...attr, type: 'string' }), 'Required value');
	assert.equal(fieldIssue('false', { ...attr, type: 'bool' }), undefined);
	assert.equal(fieldIssue('0', { ...attr, type: 'number' }), undefined);
	assert.equal(fieldIssue('NaN', { ...attr, type: 'number' }), 'Enter a finite number');
	assert.equal(fieldIssue('{}', { ...attr, type: 'list' }), 'Enter a JSON array');
	assert.equal(fieldIssue('[]', { ...attr, type: 'map' }), 'Enter a JSON object');
	assert.equal(fieldIssue('var.allowed', { ...attr, type: 'list' }), undefined);
});

test('sample cluster does not create a second editable default node pool', () => {
	const cluster = sampleArchitecture().resources.find(resource => resource.kind === 'cluster')!;
	assert.equal(additionalBlocks(cluster).some(block => block.type === 'default_node_pool'), false);
});

test('semantic edits and resource positions share one history across both renderers', () => {
	const initial = createHistory(sampleArchitecture());
	const moved = historyReducer(initial, { type: 'move', id: 'network', mode: 'technical', position: { x: 900, y: 10 } });
	const renamed = historyReducer(moved, { type: 'update', id: 'network', patch: { name: 'renamed-network' } });
	assert.equal(renamed.present.resources[0].name, 'renamed-network');
	assert.deepEqual(renamed.present.resources[0].positions.visual, {x:900,y:10});
	assert.deepEqual(renamed.present.resources[0].positions.technical, renamed.present.resources[0].positions.visual);
	assert.deepEqual(historyReducer(renamed, { type: 'undo' }), { ...moved, future: [renamed.present] });
	assert.deepEqual(historyReducer(historyReducer(renamed, { type: 'undo' }), { type: 'redo' }).present, renamed.present);
	assert.equal(initial.present.resources[0].name, 'vnet-production');
});

test('deleting a resource removes its connections and undo restores them together', () => {
	const initial = createHistory(sampleArchitecture());
	const deleted = historyReducer(initial, { type: 'delete', id: 'subnet' });
	assert.equal(deleted.present.connections.some(connection => endpointElementId(connection.source) === 'subnet' || endpointElementId(connection.target) === 'subnet'), false);
	assert.deepEqual(historyReducer(deleted, { type: 'undo' }).present, initial.present);
});

test('a new edit after undo discards the redo branch', () => {
	const initial = createHistory(sampleArchitecture());
	const edited = historyReducer(initial, { type: 'update', id: 'network', patch: { name: 'first' } });
	const undone = historyReducer(edited, { type: 'undo' });
	const changed = historyReducer(undone, { type: 'update', id: 'network', patch: { name: 'second' } });
	assert.equal(changed.future.length, 0);
	assert.equal(historyReducer(changed, { type: 'redo' }), changed);
});

test('connections reject dangling, self and duplicate links without adding history', () => {
	const initial = createHistory(sampleArchitecture());
	for (const [source, target] of [['missing', 'network'], ['network', 'network'], ['network', 'subnet']]) {
		assert.equal(historyReducer(initial, { type: 'connect', source, target }), initial);
	}
});

test('draft name findings are derived from current edits and clear after correction', () => {
	const initial = createHistory(sampleArchitecture());
	const duplicate = historyReducer(initial, { type: 'update', id: 'subnet', patch: { name: 'VNET-PRODUCTION' } });
	assert.equal(checkDraft(duplicate.present).length, 1);
	assert.deepEqual(checkDraft(initial.present), []);
});

test('moving a frame moves its members in both renderers as one undoable edit', () => {
	const initial = createHistory(framedArchitecture());
	const moved = historyReducer(initial, { type: 'moveItem', id: 'frame-network', mode: 'visual', position: { x: 120, y: 165 } });
	assert.equal(moved.present.resources[0].positions.visual.x, initial.present.resources[0].positions.visual.x + 100);
	assert.deepEqual(moved.present.resources[0].positions.technical, moved.present.resources[0].positions.visual);
	assert.deepEqual(moved.present.resources[2], initial.present.resources[2]);
	assert.deepEqual(historyReducer(moved, { type: 'undo' }).present, initial.present);
});


test('unchanged inline field input does not consume an undo step', () => {
 const initial = createHistory(sampleArchitecture());
 const changed = historyReducer(initial, { type: 'update', id: 'cluster', patch: { name: 'shared-inline' } });
 assert.equal(historyReducer(changed, { type: 'update', id: 'cluster', patch: { name: 'shared-inline' } }), changed);
 assert.deepEqual(historyReducer(changed, { type: 'undo' }).present, initial.present);
});

test('inserting a template is one undo step for resources and their relationships', () => {
 const initial=createHistory(sampleArchitecture());
 const template=sampleArchitecture();
 template.resources=template.resources.slice(0,2).map(resource=>({...resource,id:'template-'+resource.id}));
 template.items=[];
 template.connections=[{id:'template-link',source:elementEndpoint('template-network'),target:elementEndpoint('template-subnet')}];
 const added=historyReducer(initial,{type:'insert',architecture:template});
 assert.equal(added.present.resources.length,initial.present.resources.length+2);
 assert.ok(added.present.connections.some(edge=>edge.id==='template-link'));
 assert.equal(added.past.length,1);
 assert.deepEqual(historyReducer(added,{type:'undo'}).present,initial.present);
 assert.deepEqual(historyReducer(historyReducer(added,{type:'undo'}),{type:'redo'}).present,added.present);
});


test('shape geometry and top-left resize share history across renderers and undo atomically', () => {
 const initial = createHistory(sampleArchitecture());
 const added = historyReducer(initial, { type: 'addItem', item: { id: 'shape-test', kind: 'shape', shape: 'diamond', text: 'Decision', positions: { visual: { x: 100, y: 100 }, technical: { x: 400, y: 400 } }, width: 200, height: 120, members: [] } });
 const resized = historyReducer(added, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 60, y: 80 }, width: 240, height: 140 });
 const item = resized.present.items.find(item => item.id === 'shape-test')!;
 assert.equal(resized.past.length, added.past.length + 1);
 assert.deepEqual(item.positions, { visual: { x: 60, y: 80 }, technical: { x: 60, y: 80 } });
 assert.equal(item.shape, 'diamond');
 assert.equal(item.width, 240);
 assert.deepEqual(historyReducer(resized, { type: 'undo' }).present, added.present);
 assert.equal(historyReducer(resized, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 60, y: 80 }, width: 240, height: 140 }), resized);
 assert.equal(historyReducer(resized, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 0, y: 0 }, width: NaN, height: 140 }), resized);
});

test('presentation export retains each shape geometry and escapes labels', async () => {
 const items: BoardItem[] = shapeDefinitions.map((shape, index) => ({ id: shape.id, kind: 'shape' as const, shape: shape.id, text: '<review & approve>', fill: '#ffffff', positions: { visual: { x: index * 220, y: 0 }, technical: { x: 0, y: 0 } }, width: 200, height: 140, members: [] }));
 items[0] = { ...items[0], strokeColor: '#123456', strokeWidth: 3, strokeStyle: 'dashed' };
 const svg = await presentationSvg({ name: 'Shapes', resources: [], connections: [], items });
 for (const shape of shapeDefinitions) { assert.ok(svg.includes('d="' + shape.path + '"')); }
 assert.ok(svg.includes('stroke="#123456" stroke-width="3" stroke-dasharray="12 9"'));
 assert.ok(svg.includes('&lt;review &amp; approve&gt;'));
 assert.ok(!svg.includes('<review & approve>'));
});


test('variable defaults preserve empty, false and zero, and edits share semantic undo', () => {
 const initial = createHistory(sampleArchitecture());
 const variable: VariableDefinition = { id: 'input-1', name: 'replicas', type: 'number', description: '', sensitive: false, defaultValue: 0 };
 const added = historyReducer(initial, { type: 'saveVariable', variable });
 assert.equal(added.present.variables?.[0].defaultValue, 0);
 assert.deepEqual(historyReducer(added, { type: 'undo' }).present, initial.present);
 assert.equal(historyReducer(added, { type: 'saveVariable', variable: { ...variable, id: 'duplicate' } }), added);
 assert.equal(historyReducer(added, { type: 'saveVariable', variable: { ...variable, defaultValue: 'bad-number' } }), added);
 assert.ok(variableDeclarations([{ ...variable, name: 'enabled', type: 'bool', defaultValue: false }]).includes('default = false'));
 assert.ok(variableDeclarations([{ ...variable, name: 'label', type: 'string', defaultValue: '' }]).includes('default = ""'));
});

test('referenced variables cannot be deleted or renamed by the draft reducer', () => {
 const architecture = sampleArchitecture();
 architecture.resources[0].settings = { cidr: 'var.network_cidr' };
 architecture.variables = [{ id: 'cidr', name: 'network_cidr', type: 'string', description: '', sensitive: false }];
 const initial = createHistory(architecture);
 assert.deepEqual([...variableUses(architecture).get('network_cidr')!], [architecture.resources[0].id]);
 assert.equal(historyReducer(initial, { type: 'deleteVariable', id: 'cidr' }), initial);
 assert.equal(historyReducer(initial, { type: 'saveVariable', variable: { ...architecture.variables[0], name: 'renamed' } }), initial);
});

test('variable exports omit sensitive values and escape literal HCL template openers', () => {
 const architecture = sampleArchitecture();
 architecture.variables = [{ id: 'secret', name: 'token', type: 'string', description: '', sensitive: true, defaultValue: 'private-default', value: 'private-value' }];
 const exported = JSON.stringify(exportableArchitecture(architecture));
 const code = variableDeclarations(architecture.variables);
 assert.ok(!exported.includes('private-default') && !exported.includes('private-value'));
 assert.ok(!code.includes('private-default') && !code.includes('private-value'));
 assert.ok(code.includes('sensitive = true'));
 assert.equal(architecture.variables[0].value, 'private-value');
 const literal = variableDeclarations([{ id: 'literal', name: 'labels', type: 'map(string)', description: '', sensitive: false, defaultValue: { literal: '${untrusted}' } }]);
 assert.ok(literal.includes('$${untrusted}'));
});


test('discovered variable declarations are inserted as one undo operation', () => {
 const initial = createHistory(sampleArchitecture());
 const added = historyReducer(initial, { type: 'addVariables', variables: ['region_input', 'size_input'].map(name => ({ id: name, name, type: 'any' as const, description: '', sensitive: false })) });
 assert.equal(added.present.variables?.length, 2);
 assert.equal(added.past.length, 1);
 assert.deepEqual(historyReducer(added, { type: 'undo' }).present, initial.present);
 const invalid = historyReducer(initial, { type: 'addVariables', variables: ['duplicate', 'duplicate'].map((name, index) => ({ id: String(index), name, type: 'string' as const, description: '', sensitive: false })) });
 assert.equal(invalid, initial);
});


test('Terraform code scopes to main or the selected resource using the source generator', () => {
 const architecture = sampleArchitecture();
 const main = terraformCode(architecture);
 const selected = terraformCode(architecture, 'network');
 assert.ok(main.includes('resource "azurerm_virtual_network"'));
 assert.ok(main.includes('resource "azurerm_kubernetes_cluster"'));
 assert.ok(selected.includes('address_space'));
 assert.ok(!selected.includes('resource "azurerm_kubernetes_cluster"'));
});

test('supported resource HCL applies atomically and keeps the Terraform identifier stable', () => {
 const initial = createHistory(sampleArchitecture());
 const source = terraformCode(initial.present, 'network');
 const edited = source.replace(/(\n\s+name\s*=\s*)"vnet-production"/, '$1"vnet-edited"');
 assert.notEqual(source, edited);
 const resources = applyTerraformDraft(initial.present, edited, 'network');
 assert.equal(resources[0].name, 'vnet-edited');
 assert.equal(resources[0].terraformName, 'vnet-production');
 const applied = historyReducer(initial, { type: 'applyResourceCode', resources });
 assert.equal(applied.past.length, 1);
 assert.deepEqual(historyReducer(applied, { type: 'undo' }).present, initial.present);
 assert.ok(terraformCode(applied.present, 'network').includes('resource "azurerm_virtual_network" "vnet-production"'));
});

test('unsupported Terraform edits reject without changing the graph', () => {
 const architecture = sampleArchitecture();
 const before = JSON.stringify(architecture);
 const source = terraformCode(architecture, 'network');
 assert.throws(() => applyTerraformDraft(architecture, source + '\n# custom comment', 'network'), /comments/);
 assert.throws(() => applyTerraformDraft(architecture, source.replace(/}\s*$/, '  unmodelled = true\n}'), 'network'), /unmodelled/);
 assert.equal(JSON.stringify(architecture), before);
});


test('variable declaration and tfvars imports distinguish defaults, assigned values and conflicts', () => {
 const declarations = importVariableDraft('variable "enabled" {\n type = bool\n default = false\n}\nvariable "count_input" {\n type = number\n default = 0\n}', [], 'tf');
 assert.equal(declarations[0].defaultValue, false);
 assert.equal(declarations[1].defaultValue, 0);
 const values = importVariableDraft('enabled = true', declarations, 'tfvars');
 assert.equal(values[0].defaultValue, false);
 assert.equal(values[0].value, true);
 const initial = createHistory({ ...sampleArchitecture(), variables: declarations });
 const kept = historyReducer(initial, { type: 'importVariables', variables: values, override: false });
 assert.equal(kept.present.variables?.[0].value, undefined);
 const replaced = historyReducer(initial, { type: 'importVariables', variables: values, override: true });
 assert.equal(replaced.present.variables?.[0].value, true);
 assert.equal(replaced.past.length, 1);
 assert.deepEqual(historyReducer(replaced, { type: 'undo' }).present, initial.present);
});

test('variable imports refuse unsupported expressions, validations and structural types', () => {
 assert.throws(() => importVariableDraft('input_value = var.other', [], 'tfvars'), /Expression/);
 assert.throws(() => importVariableDraft('variable "x" {\n type = tuple([string, number])\n}', [], 'tf'), /structural type/);
 assert.throws(() => importVariableDraft('variable "x" {\n type = string\n validation {\n condition = true\n error_message = "bad"\n }\n}', [], 'tf'), /advanced attributes/);
});

test('sensitive resource properties are omitted from graph and Terraform projections', () => {
 const architecture = sampleArchitecture();
 architecture.resources[0] = { ...architecture.resources[0], kind: 'compute', settings: { admin_password: 'private-resource-password' } };
 assert.ok(!JSON.stringify(exportableArchitecture(architecture)).includes('private-resource-password'));
 assert.ok(!terraformCode(architecture).includes('private-resource-password'));
});

test('Azure, AWS and Google nesting follows bundled parent rules and rejects provider boundaries and cycles', () => {
 const architecture=sampleArchitecture(); const network=architecture.resources[0]; const subnet=architecture.resources[1];
 const awsNetwork={...network,id:'vpc',provider:'aws' as const,parentId:undefined}; const awsSubnet={...subnet,id:'aws-subnet',provider:'aws' as const,parentId:undefined};
 const gcpNetwork={...network,id:'gcp-network',provider:'gcp' as const,parentId:undefined}; const gcpSubnet={...subnet,id:'gcp-subnet',provider:'gcp' as const,parentId:undefined};
 architecture.resources.push(awsNetwork,awsSubnet,gcpNetwork,gcpSubnet);
 assert.equal(resourcePlacement(architecture,subnet,'network').parentId,'network');
 assert.equal(resourcePlacement(architecture,awsSubnet,'vpc').parentId,'vpc');
 assert.equal(resourcePlacement(architecture,gcpSubnet,'gcp-network').parentId,'gcp-network');
 assert.equal(resourcePlacement(architecture,awsSubnet,'network').ok,false);
 assert.equal(resourcePlacement(architecture,network,'subnet').ok,false);
 assert.equal(resourcePlacement(architecture,subnet,'resource-group').ok,false);
 const storage=architecture.resources.find(resource=>resource.id==='storage')!;
 assert.equal(resourcePlacement(architecture,storage,'subnet').parentId,'resource-group');
 const initial=createHistory(architecture);
 assert.equal(historyReducer(initial,{type:'placeResource',id:'subnet',parentId:'resource-group',mode:'visual',positions:{subnet:{x:0,y:0}}}),initial);
});

test('moving an infrastructure container shifts every descendant once in both renderers and undoes atomically', () => {
 const architecture=sampleArchitecture(); const parent=architecture.resources.find(resource=>resource.id==='network')!;
 const moved=historyReducer(createHistory(architecture),{type:'move',id:'network',mode:'technical',position:{x:parent.positions.technical.x+75,y:parent.positions.technical.y+60}});
 for(const before of [parent,...resourceDescendants(architecture,parent.id)]){
  const after=moved.present.resources.find(resource=>resource.id===before.id)!;
  assert.deepEqual(after.positions.visual,{x:before.positions.visual.x+75,y:before.positions.visual.y+60});
  assert.deepEqual(after.positions.technical,after.positions.visual);
 }
 assert.equal(moved.past.length,1);
	const semantics=(value:Architecture)=>projectTerraform(value).project.nodes.map(({id,parentId,name,config})=>({id,parentId,name,config})).sort((a,b)=>a.id.localeCompare(b.id));
	assert.deepEqual(semantics(moved.present),semantics(architecture));
 assert.deepEqual(historyReducer(moved,{type:'undo'}).present,architecture);
});

test('nested inheritance projects stable typed references without mutating stored literals or creating blocks', () => {
 const architecture=sampleArchitecture(); const before=JSON.stringify(architecture); const projected=projectTerraform(architecture).project;
 const nic=projected.nodes.find(node=>node.id==='nic')!;
 assert.deepEqual(nic.config.resource_group_name,{$ref:'resource-group',attr:'name',inherited:true});
 const ip=nic.config.ip_configuration as Record<string,unknown>[];
 assert.deepEqual((Array.isArray(ip)?ip[0]:ip).subnet_id,{$ref:'subnet',attr:'id',inherited:true});
 assert.match(terraformCode(architecture,'nic'),/subnet_id\s*=\s*azurerm_subnet\.snet-applications\.id/);
 const removed={...architecture,resources:architecture.resources.map(resource=>resource.id==='nic'?{...resource,blocks:[]}:resource)};
 assert.equal(projectTerraform(removed).project.nodes.find(node=>node.id==='nic')!.config.ip_configuration,undefined);
 assert.ok(!inheritedReferences(removed,removed.resources.find(resource=>resource.id==='nic')!).some(reference=>reference.path[0]==='ip_configuration'));
 assert.equal(JSON.stringify(architecture),before);
});

test('inherited references survive supported code apply and refuse an unmodelled reference edit', () => {
 const architecture=sampleArchitecture(); const code=terraformCode(architecture,'nic');
 const edits=applyTerraformDraft(architecture,code.replace(/name\s*=\s*"nic-application"/,'name = "nic-reviewed"'),'nic');
 assert.equal(edits[0].name,'nic-reviewed');
 assert.equal(edits[0].terraformName,'nic-application');
 assert.match(terraformCode({...architecture,resources:architecture.resources.map(resource=>resource.id==='nic'?edits[0]:resource)},'nic'),/subnet_id\s*=\s*azurerm_subnet\.snet-applications\.id/);
 assert.throws(()=>applyTerraformDraft(architecture,code.replace('azurerm_subnet.snet-applications.id','azurerm_subnet.other.id'),'nic'),/represented|expressions|unmodelled/);
});

test('inheritance override, variable binding and detach preserve inactive literals with one semantic undo', () => {
 const architecture={...sampleArchitecture(),variables:[{id:'region-input',name:'region_input',type:'string' as const,description:'',sensitive:false,defaultValue:'ukwest'}]};
 const initial=createHistory(architecture);
 const override=historyReducer(initial,{type:'useInheritance',id:'vm',target:{kind:'region'},enabled:false});
 assert.ok(!inheritedReferences(override.present,override.present.resources.find(resource=>resource.id==='vm')!).some(reference=>reference.path[0]==='location'));
 assert.match(terraformCode(override.present,'vm'),/location\s*=\s*"uksouth"/);
 const restore=historyReducer(override,{type:'useInheritance',id:'vm',target:{kind:'region'},enabled:true});
 assert.match(terraformCode(restore.present,'vm'),/location\s*=\s*azurerm_resource_group\.rg-production\.location/);
 const variable=historyReducer(restore,{type:'bindVariable',id:'vm',target:{kind:'region'},variableId:'region-input'});
 assert.match(terraformCode(variable.present,'vm'),/location\s*=\s*var\.region_input/);
 const detached=historyReducer(initial,{type:'placeResource',id:'vm',mode:'visual'});
 assert.equal(detached.present.resources.find(resource=>resource.id==='vm')!.parentId,undefined);
 assert.equal(inheritedReferences(detached.present,detached.present.resources.find(resource=>resource.id==='vm')!).length,0);
 assert.equal(detached.present.resources.find(resource=>resource.id==='vm')!.region,'UK South');
 assert.equal(detached.past.length,1); assert.deepEqual(historyReducer(detached,{type:'undo'}).present,architecture);
});

test('resource display-name changes preserve identifiers and ancestor references', () => {
 const initial=createHistory(sampleArchitecture());
 const renamed=historyReducer(initial,{type:'update',id:'resource-group',patch:{name:'rg-renamed'}});
 assert.equal(renamed.present.resources.find(resource=>resource.id==='resource-group')!.terraformName,'rg-production');
 assert.match(terraformCode(renamed.present,'vm'),/azurerm_resource_group\.rg-production\.name/);
 assert.match(terraformCode(renamed.present,'resource-group'),/name\s*=\s*"rg-renamed"/);
});

test('copying a nested container remaps its hierarchy and inheritance while keeping the source intact', () => {
 const architecture=sampleArchitecture(); const fragment=selectionFragment(architecture,['resource-group']);
 assert.equal(fragment.resources.length,architecture.resources.length);
 const ids=Object.fromEntries(fragment.resources.map(resource=>[resource.id,'copy-'+resource.id]));
 const copied=applyCanvasCommand(architecture,{kind:'duplicate',fragment,idMap:ids,offset:50});
 assert.equal(copied.resources.find(resource=>resource.id==='copy-subnet')!.parentId,'copy-network');
 assert.equal(copied.resources.find(resource=>resource.id==='copy-vm')!.parentId,'copy-subnet');
 assert.match(terraformCode(copied,'copy-vm'),/azurerm_resource_group\.rg-production_copy\.name/);
 assert.deepEqual(copied.resources.slice(0,architecture.resources.length),architecture.resources);
 const locked={...architecture,resources:architecture.resources.map(resource=>resource.id==='vm'?{...resource,canvasLocked:true}:resource)};
 assert.equal(applyCanvasCommand(locked,{kind:'delete',ids:['resource-group']}),locked);
 assert.equal(applyCanvasCommand(locked,{kind:'move',mode:'visual',positions:{network:{x:500,y:600}}}),locked);
 const removed=historyReducer(createHistory(architecture),{type:'delete',id:'network'});
 assert.ok(!removed.present.resources.some(resource=>['network','subnet','vm','nic'].includes(resource.id)));
 assert.deepEqual(historyReducer(removed,{type:'undo'}).present,architecture);
});

test('container resize preserves child world positions, fits its contents and rejects invalid geometry', () => {
 const architecture=sampleArchitecture(); const container=architecture.resources.find(resource=>resource.id==='network')!;
 const initial=createHistory(architecture);
 const resized=historyReducer(initial,{type:'resizeContainer',id:'network',position:container.positions.visual,width:900,height:800});
 assert.deepEqual(resized.present.resources.find(resource=>resource.id==='vm')!.positions,architecture.resources.find(resource=>resource.id==='vm')!.positions);
 assert.equal(resourceDimensions(resized.present,resized.present.resources[0],'visual').width,900);
 assert.equal(resized.past.length,1);
 assert.equal(historyReducer(resized,{type:'resizeContainer',id:'network',position:container.positions.visual,width:900,height:800}),resized);
 for(const width of [NaN,0,10001]){assert.equal(historyReducer(initial,{type:'resizeContainer',id:'network',position:container.positions.visual,width,height:300}),initial);}
 assert.equal(historyReducer(initial,{type:'resizeResource',id:'network',position:container.positions.visual,iconSize:96}),initial);
});

test('local diagnostics link nested required fields, CIDR containment, overlaps and invalid parents to resource IDs', () => {
 const architecture=sampleArchitecture();
 assert.ok(architectureDiagnostics(architecture).some(item=>item.resourceId==='vm'&&item.path==='os_disk'&&item.severity==='error'));
 assert.ok(!architectureDiagnostics(architecture).some(item=>item.resourceId==='vm'&&item.path==='resource_group_name'));
 const subnet=architecture.resources.find(resource=>resource.id==='subnet')!; subnet.settings['Address prefix']='192.168.0.0/24';
 assert.ok(architectureDiagnostics(architecture).some(item=>item.resourceId==='subnet'&&item.message.includes('inside its parent')));
 subnet.settings['Address prefix']='999.2.3.4/24';
 assert.ok(architectureDiagnostics(architecture).some(item=>item.resourceId==='subnet'&&item.message.includes('valid IPv4')));
 subnet.parentId='missing';
 assert.ok(architectureDiagnostics(architecture).some(item=>item.resourceId==='subnet'&&item.path==='parent'));
 architecture.resources.push({...architecture.resources[0],id:'overlap',name:'vnet-overlap'});
 assert.ok(architectureDiagnostics(architecture).some(item=>item.severity==='warning'&&item.message.includes('overlap')));
 const overlap=architectureDiagnostics(architecture).find(item=>item.severity==='warning'&&item.message.includes('overlap'));
 assert.deepEqual(overlap?.targets?.map(target=>target.resourceId).sort(),[architecture.resources[0].id,'overlap'].sort(),'an overlap points at both networks');
 assert.ok(overlap?.targets?.every(target=>target.path),'each target opens its address range field');
});

test('flowchart starters share editable geometry, labelled links and atomic insertion/undo', async () => {
 const initial=createHistory(sampleArchitecture()); const template=workflowTemplate({x:200,y:300},'review');
 assert.equal(new Set([...template.items,...template.connections].map(item=>item.id)).size,template.items.length+template.connections.length);
 assert.ok(template.items.every(item=>item.positions.visual.x===item.positions.technical.x&&item.positions.visual.y===item.positions.technical.y));
 assert.ok(template.connections.some(link=>link.label==='Yes')&&template.connections.some(link=>link.label==='No'));
 const inserted=historyReducer(initial,{type:'insert',architecture:template});
 assert.equal(inserted.past.length,1); assert.deepEqual(historyReducer(inserted,{type:'undo'}).present,initial.present);
 const svg=await presentationSvg(template);
 assert.ok(svg.includes('Approved?')&&svg.includes('Review Terraform plan'));
 assert.ok(template.items.every(item=>shapeDefinitions.some(shape=>shape.id===item.shape&&svg.includes(shape.path))));
});

test('typed variable controls preserve empty text, false, zero and explicit null without treating them as missing', () => {
 assert.equal(parseVariableInput('', 'string'), '');
 assert.equal(parseVariableInput('false', 'bool'), false);
 assert.equal(parseVariableInput('0', 'number'), 0);
 assert.equal(parseVariableInput('null', 'number'), null);
 assert.deepEqual(parseVariableInput('["web", "api"]', 'list(string)'), ['web', 'api']);
 assert.deepEqual(parseVariableInput('{"team":"platform"}', 'map(string)'), {team:'platform'});
 const initial=createHistory(sampleArchitecture());
 const saved=historyReducer(initial,{type:'saveVariable',variable:{id:'replicas',name:'replicas',type:'number',description:'',sensitive:false,defaultValue:parseVariableInput('2','number'),value:parseVariableInput('0','number')}});
 assert.equal(saved.present.variables?.[0].value,0);
 assert.equal(saved.present.variables?.[0].defaultValue,2);
 assert.equal(saved.past.length,1);
 assert.deepEqual(historyReducer(saved,{type:'undo'}).present,initial.present);
});

test('typed variable feedback rejects wrong values and expressions before a save can replace valid values', () => {
 assert.ok(variableInputIssue('enabled','bool')?.includes('true or false'));
 assert.ok(variableInputIssue('"2"','number')?.includes('number'));
 assert.ok(variableInputIssue('[1]','list(string)')?.includes('quoted text'));
 assert.ok(variableInputIssue('{"replicas":2}','map(string)')?.includes('text keys'));
 assert.ok(variableInputIssue('var.other','any')?.includes('Valid JSON'));
 assert.ok(variableInputIssue('','number'));
 assert.equal(variableInputIssue('0','number'),undefined);
 assert.equal(variableInputIssue('','string'),undefined);
});

test('object variables declare their shape and fields bind one nested value as var.NAME.path', () => {
	const network = { id: 'input-network', name: 'network', type: 'object' as const, description: 'Shared network settings', sensitive: false, defaultValue: { location: 'uksouth', dns: { servers: ['10.0.0.4'], zone: 'corp.local' } } };
	assert.match(variableDeclarations([network]), /type = object\(\{ location = string, dns = object\(\{ servers = list\(string\), zone = string \}\) \}\)/);
	assert.deepEqual(objectVariablePaths(network).map(entry => entry.path.join('.')), ['location', 'dns', 'dns.servers', 'dns.zone']);
	assert.equal(acceptsVariable(network, { type: 'string' }), false);
	assert.equal(acceptsVariable(network, { type: 'string' }, ['location']), true);
	assert.equal(acceptsVariable(network, { type: 'string' }, ['dns', 'servers']), false);
	assert.equal(acceptsVariable(network, { type: 'list' }, ['dns', 'servers']), true);
	assert.equal(acceptsVariable(network, { type: 'string' }, ['missing']), false);
	const architecture = { ...sampleArchitecture(), variables: [network] };
	const bound = historyReducer(createHistory(architecture), { type: 'bindVariable', id: 'network', target: { kind: 'region' }, variableId: 'input-network', path: ['location'] });
	assert.match(terraformCode(bound.present, 'network'), /location\s*=\s*var\.network\.location/);
	assert.deepEqual(bound.present.resources.find(item => item.id === 'network')!.fieldBindings?.[JSON.stringify(['region'])], { variableId: 'input-network', path: ['location'] });
	assert.ok(variableUses(bound.present).get('network')?.has('network'));
	assert.equal(historyReducer(bound, { type: 'bindVariable', id: 'network', target: { kind: 'region' }, variableId: 'input-network', path: ['dns', 'servers'] }), bound, 'a list value cannot bind to a text field');
	assert.equal(variableBindingIssue({ variableId: 'input-network', path: ['gone'] }, [network], { type: 'string' }), 'var.network.gone no longer exists in the object. Choose another value.');
	assert.equal(variableError({ ...network, defaultValue: ['not', 'an', 'object'] }, []), 'The default and value must match the selected type.');
	const imported = importVariableDraft('variable "network" {\n  type = object({ location = string })\n  default = { location = "uksouth" }\n}', [], 'tf');
	assert.equal(imported[0].type, 'object');
	assert.match(variableDeclarations(imported), /type = object\(\{ location = string \}\)/, 'the imported constraint is written back unchanged');
});

test('dependency line styles are appearance only, validated, undoable and never touch Terraform', () => {
	const initial = createHistory(sampleArchitecture());
	const before = terraformCode(initial.present);
	let history = historyReducer(initial, { type: 'styleDependency', key: '*', patch: { routing: 'curve', width: 2 } });
	history = historyReducer(history, { type: 'styleDependency', key: 'dependency:a:b', patch: { stroke: '#123456', pattern: 'solid' } });
	assert.deepEqual(history.present.dependencyStyles, { '*': { routing: 'curve', width: 2 }, 'dependency:a:b': { stroke: '#123456', pattern: 'solid' } });
	assert.equal(terraformCode(history.present), before);
	assert.equal(historyReducer(history, { type: 'styleDependency', key: '*', patch: { width: 99 } }), history);
	assert.equal(historyReducer(history, { type: 'styleDependency', key: '*', patch: { routing: 'zigzag' as 'curve' } }), history);
	assert.equal(historyReducer(history, { type: 'styleDependency', key: '*', patch: { routing: 'curve' } }), history);
	history = historyReducer(history, { type: 'styleDependency', key: 'dependency:a:b', patch: null });
	history = historyReducer(history, { type: 'styleDependency', key: '*', patch: null });
	assert.equal(history.present.dependencyStyles, undefined);
	history = historyReducer(history, { type: 'undo' });
	assert.deepEqual(history.present.dependencyStyles, { '*': { routing: 'curve', width: 2 } });
});
