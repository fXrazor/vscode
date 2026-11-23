import { useId } from 'react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { fieldIssue } from './formDefinition.ts';

/** Controlled by the canonical resource, shared by inline nested forms. */
export function SchemaField({ name, value, definition, onChange }: { name: string; value: string; definition?: AttrDef; onChange: (value: string) => void }) {
	const id = useId(); const issue = fieldIssue(value, definition);
	const props = { id, value, 'aria-invalid': !!issue, 'aria-required': !!definition?.required, 'aria-describedby': id + '-help', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value) };
	return <div className="schema-field">
		<label htmlFor={id}>{name.replaceAll('_', ' ')}{definition?.required && <span className="field-required" aria-hidden="true"> *</span>}<span className="schema-field-type" aria-hidden="true">{definition?.type ?? 'value'}</span></label>
		{definition?.type === 'bool' || definition?.options?.length ? <select {...props}><option value="">Not set</option>{(definition.options ?? ['true', 'false']).map(option => <option key={option}>{option}</option>)}{value && !(definition.options ?? ['true', 'false']).includes(value) && <option>{value}</option>}</select> : definition?.type === 'list' || definition?.type === 'map' ? <textarea {...props} rows={2} spellCheck={false} /> : <input {...props} type={definition?.sensitive ? 'password' : 'text'} inputMode={definition?.type === 'number' ? 'decimal' : undefined} placeholder={definition?.placeholder} />}
		<div id={id + '-help'} className={issue ? 'schema-field-error' : 'field-help'}>{issue ?? definition?.description}</div>
	</div>;
}
