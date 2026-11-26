/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpLeft, ChevronRight, ExternalLink, Link2 } from 'lucide-react';
import type { Architecture, Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { configuredImpact, documentedHubSpokes, infrastructureRelationships, relationshipNames } from './infrastructureRelationships.ts';
import { resourceIntelligence } from './providerKnowledge.ts';

/** Contextual evidence, not an extra persistent graph panel or a second architecture. */
export function RelationshipContext({ architecture, resource, onNavigate }: { architecture: Architecture; resource: Resource; onNavigate: (id: string) => void }) {
	const relationships = useMemo(() => infrastructureRelationships(architecture), [architecture]);
	const upstream = relationships.filter(link => link.target === resource.id);
	const impact = configuredImpact(relationships, resource.id);
	const profile = resourceIntelligence(resourceDefinition(resource).type);
	const star = documentedHubSpokes(architecture, relationships).find(star => star.hub === resource.id);
	const linkTo = (id: string) => {
		const target = architecture.resources.find(candidate => candidate.id === id);
		return target ? <button className="relationship-resource" onClick={() => onNavigate(id)}><img src={'./assets/' + resourceDefinition(target).icon} alt=""/><span>{target.label || target.name}</span><ChevronRight size={13}/></button> : null;
	};
	return <div className="relationship-context">
		<section className="workspace-context-section"><h3><ArrowUpLeft size={14}/>Uses resources <span>{new Set(upstream.map(link => link.source)).size}</span></h3>
			{upstream.length ? upstream.map(link => <div className="relationship-evidence" key={link.id}><span className={'relationship-kind relationship-' + link.category}>{relationshipNames[link.category]}</span>{linkTo(link.source)}
				{link.evidence.map(evidence => <details key={evidence.field + ':' + evidence.expression}><summary><code>{evidence.field}</code><small>{evidence.origin === 'service' ? 'Source graph' : evidence.origin === 'inherited' ? 'Inherited draft field' : 'Draft binding'}</small></summary>{evidence.expression && <code className="relationship-expression">{evidence.expression}</code>}<p>{evidence.meaning}</p>{link.ordering && <p className="field-help">Also establishes configured ordering. This is not a traffic-flow arrow.</p>}</details>)}
			</div>) : <p className="field-help">No configured input relationships are available for this resource.</p>}
		</section>
		<section className="workspace-context-section configured-impact"><h3><ArrowDownRight size={14}/>Configured impact</h3><p><strong>{impact.direct.length}</strong> direct dependents · <strong>{impact.transitive.length}</strong> further downstream</p>
			{impact.direct.slice(0, 8).map(id => <div key={id}>{linkTo(id)}</div>)}
			{impact.direct.length > 8 && <details><summary>{impact.direct.length - 8} more direct dependents</summary>{impact.direct.slice(8).map(id => <div key={id}>{linkTo(id)}</div>)}</details>}
			{impact.transitive.length > 0 && <details><summary>Trace downstream resources</summary>{impact.transitive.map(id => <div key={id}>{linkTo(id)}</div>)}</details>}
			<p className="context-boundary">References in this draft can be affected by a change. This does not predict outages, replacements or resources outside the model. A Terraform plan is needed for action impact.</p>
		</section>
		{star && <section className="workspace-context-section"><h3><Link2 size={14}/>Hub/spoke candidate</h3><p>{star.spokes.length} peer networks have explicit peering endpoints in this draft. Reciprocal peering, transit routes and network health still need checking.</p></section>}
		<details className="workspace-context-guide provider-investigation"><summary>Provider investigation guide</summary>
			{profile.reviewStatus === 'documented' ? <><dl><dt>Role</dt><dd>{profile.layer}</dd><dt>Shared component category</dt><dd>{profile.blastRadiusCategory}</dd><dt>Cost category</dt><dd>{profile.costCategory} · no estimate</dd></dl><ul>{[...profile.troubleshooting, ...profile.commonRuntimeLinks, ...profile.securityRelationships, ...profile.monitoringRelationships].map((hint, index) => <li key={index}>{hint}</li>)}</ul><p className="field-help">Documentation guidance; selected provider version, live policies and health still need validation.{profile.platform === 'aws' ? ' AWS research is not version-matched to catalogue 6.73.1.' : ''}</p><a href={documentationUrl(profile.platform, profile.sourceKey)} target="_blank" rel="noreferrer">Provider documentation <ExternalLink size={12}/></a></> : <p>No reviewed relationship rules for this type. Inspect its selected provider documentation and version-matched schema. Value references remain visible without guessing their operational meaning.</p>}
		</details>
	</div>;
}

function documentationUrl(platform: string, sourceKey?: string) {
	const resource = sourceKey?.split(':')[1] ?? '';
	if (platform === 'azure') { return 'https://github.com/hashicorp/terraform-provider-azurerm/blob/01e374080dc522c063c8bcd753bb5d1423e3be3b/website/docs/r/' + resource + '.html.markdown'; }
	if (platform === 'aws') { return 'https://github.com/hashicorp/terraform-provider-aws/blob/e01f7a86e40e0217eb243b04b08aa5447469375f/website/docs/r/' + resource + '.html.markdown'; }
	return 'https://github.com/hashicorp/terraform-provider-google/blob/abd6d1130c758fed9ee011f11c0c2274b9279e96/website/docs/r/' + ({ project_iam_member: 'google_project_iam', service_account: 'google_service_account' }[resource] ?? resource) + '.html.markdown';
}
