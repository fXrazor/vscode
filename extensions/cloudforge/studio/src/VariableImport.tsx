import { useState, type Dispatch } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Action } from './model.ts';
import { importVariableDraft, type VariableDefinition } from './variables.ts';

export function VariableImport({ variables, dispatch, onClose }: { variables: VariableDefinition[]; dispatch: Dispatch<Action>; onClose: () => void }) {
	const [source, setSource] = useState('');
	const [format, setFormat] = useState<'tf' | 'tfvars'>('tf');
	const [override, setOverride] = useState(false);
	const [preview, setPreview] = useState<VariableDefinition[]>();
	const [error, setError] = useState('');
	const updateSource = (value: string) => { setSource(value); setPreview(undefined); setError(''); };
	return <section className="variables-panel variable-form">
		<header><button aria-label="Back from variable import" onClick={onClose}><ArrowLeft size={16}/></button><h2>Import variables</h2></header>
		<label>File<input aria-label="Variable file" type="file" accept=".tf,.tfvars" onChange={async event => {
			const file = event.target.files?.[0]; if (!file) { return; }
			if (file.size > 1_000_000 || !/\.(tf|tfvars)$/i.test(file.name)) { setError('Choose a .tf or .tfvars file smaller than 1 MB.'); return; }
			try { setFormat(file.name.toLowerCase().endsWith('.tfvars') ? 'tfvars' : 'tf'); updateSource(await file.text()); } catch { setError('Unable to read that file.'); }
		}} /></label>
		<label>Format<select aria-label="Variable import format" value={format} onChange={event => { setFormat(event.target.value as 'tf' | 'tfvars'); setPreview(undefined); }}><option value="tf">variables.tf declarations</option><option value="tfvars">terraform.tfvars values</option></select></label>
		<label>Or paste source<textarea aria-label="Variable import source" value={source} maxLength={1_000_000} onChange={event => updateSource(event.target.value)} /></label>
		<p className="field-help">Read locally into this architecture draft. Expressions, validation blocks and unsupported structural types are rejected rather than discarded.</p>
		<label className="variable-checkbox"><input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)} />Override existing variables</label>
		{error && <p className="variable-error" role="alert">{error}</p>}
		<button disabled={!source.trim()} onClick={() => { try { setPreview(importVariableDraft(source, variables, format)); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'Unable to read these variables.'); setPreview(undefined); } }}>Review import</button>
		{preview && <><h3>Review {preview.length} variables</h3><ul className="variable-import-review">{preview.map(variable => <li key={variable.id}>{variable.name} · {variable.type} · {variable.sensitive ? 'sensitive' : 'non-sensitive'}{variables.some(existing => existing.name === variable.name) ? override ? ' · replace' : ' · keep existing' : ' · new'}</li>)}</ul><button className="primary-button" onClick={() => { dispatch({ type: 'importVariables', variables: preview, override }); onClose(); }}>Import variables</button></>}
	</section>;
}
