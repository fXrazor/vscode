/* Adapted from user-owned CloudLab Forge 3.0 app/code-editor.tsx. */

import { useEffect, useRef, useState } from "react"

// Monaco rejects in-flight work with a "Canceled" error when an editor is disposed (closing the
// focused workspace). It is expected cancellation, not a failure, so keep it out of the console.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { name?: string; message?: string } | undefined
    if (reason?.name === "Canceled" || reason?.message === "Canceled") event.preventDefault()
  })
}
type Settings = { editor?: Partial<EditorPreferences> }
import { defaultEditor, editorPalettes, editorPreferences, type EditorPalette, type EditorPreferences, type EditorTheme } from "./editor-appearance.ts"

type Disposable = { dispose: () => void }
type EditorRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
export type RevealCode = { id: number; query?: string }
interface EditorInstance extends Disposable {
  getValue: () => string
  setValue: (value: string) => void
  updateOptions: (options: Record<string, unknown>) => void
  onDidChangeModelContent: (listener: () => void) => Disposable
  getModel: () => (Disposable & { findMatches: (text: string, editable: boolean, regex: boolean, matchCase: boolean, separators: string | null, captures: boolean, limit?: number) => { range: EditorRange }[] }) | null
  setSelection: (range: EditorRange) => void
  revealRangeInCenter: (range: EditorRange) => void
  focus: () => void
  addAction: (action: { id: string; label: string; keybindings: number[]; precondition: string; run: () => void }) => Disposable
  getAction: (id: string) => { run: () => Promise<void> } | null
}
interface Monaco {
  editor: {
    create: (element: HTMLElement, options: Record<string, unknown>) => EditorInstance
    defineTheme: (name: string, theme: Record<string, unknown>) => void
    setTheme: (name: string) => void
  }
  languages: {
    getLanguages: () => { id: string }[]
    register: (language: { id: string }) => void
    setLanguageConfiguration: (id: string, configuration: Record<string, unknown>) => void
    setMonarchTokensProvider: (id: string, provider: Record<string, unknown>) => void
  }
  KeyMod: { CtrlCmd: number; Shift: number }
  KeyCode: { Enter: number; KeyS: number; KeyR: number }
}
type HclLanguage = { conf: Record<string, unknown>; language: Record<string, unknown> }
type AmdRequire = ((modules: string[], ready: (editor: unknown, hcl: HclLanguage) => void, error: (reason: unknown) => void) => void) & { config: (config: object) => void }
let monacoPromise: Promise<Monaco> | undefined

function loadMonaco(): Promise<Monaco> {
  if (!monacoPromise) monacoPromise = new Promise<Monaco>((resolve, reject) => {
    const host = window as unknown as { require?: AmdRequire; monaco?: Monaco }
    const start = () => {
      if (!host.require) return reject(new Error("Editor loader unavailable"))
      host.require.config({ paths: { vs: new URL("./assets/monaco/vs", document.baseURI).href } })
      host.require(["vs/editor/editor.main", "vs/basic-languages/hcl/hcl"], (_editor, hcl) => {
        if (!host.monaco) return reject(new Error("Editor unavailable"))
        const monaco = host.monaco
        if (!monaco.languages.getLanguages().some(({ id }) => id === "hcl")) monaco.languages.register({ id: "hcl" })
        monaco.languages.setMonarchTokensProvider("hcl", hcl.language)
        monaco.languages.setLanguageConfiguration("hcl", hcl.conf)
        resolve(monaco)
      }, reject)
    }
    if (host.require) return start()
    const script = document.createElement("script")
    script.src = new URL("./assets/monaco/vs/loader.js", document.baseURI).href
    script.onload = start
    script.onerror = () => { script.remove(); reject(new Error("Editor could not load")) }
    document.head.appendChild(script)
  }).catch((error: unknown) => { monacoPromise = undefined; throw error })
  return monacoPromise
}

export function EditorAppearance({ settings, setSettings }: { settings: Settings; setSettings: (settings: Settings) => void }) {
  const prefs = editorPreferences(settings.editor)
  const update = (patch: Partial<EditorPreferences>) => setSettings({ ...settings, editor: editorPreferences({ ...prefs, ...patch }) })
  const [editing, setEditing] = useState(false)
  return <div className="editor-appearance">
    <div className="editor-toolbar" role="group" aria-label="Code editor appearance">
      <label>Theme <select className="input" aria-label="Code editor theme" value={prefs.theme} onChange={(e) => update({ theme: e.target.value as EditorTheme })}>
        <option value="dark">Dark</option><option value="light">Light</option><option value="ocean">Ocean</option><option value="contrast">High contrast</option><option value="custom">Custom</option>
      </select></label>
      <button className="btn small" aria-label="Decrease editor text size" disabled={prefs.fontSize <= 10} onClick={() => update({ fontSize: prefs.fontSize - 1 })}>A−</button>
      <label className="editor-size"><span className="sr-only">Editor text size in pixels</span><input className="input" type="number" aria-label="Editor text size in pixels" min={10} max={28} value={prefs.fontSize} onChange={(e) => { if (e.target.value) update({ fontSize: e.target.valueAsNumber }) }} /><span>px</span></label>
      <button className="btn small" aria-label="Increase editor text size" disabled={prefs.fontSize >= 28} onClick={() => update({ fontSize: prefs.fontSize + 1 })}>A+</button>
      <button className={`btn small ${editing ? "on" : ""}`} aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit theme</button>
      <button className="btn ghost small" onClick={() => { update(defaultEditor); setEditing(false) }}>Reset</button>
    </div>
    {editing && <div className="editor-colors" role="group" aria-label="Custom editor theme colors">
      {(Object.keys(prefs.custom) as (keyof EditorPalette)[]).map((key) => <label key={key}>{key[0]!.toUpperCase() + key.slice(1)}<input type="color" aria-label={`Editor ${key} color`} value={(prefs.theme === "custom" ? prefs.custom : editorPalettes[prefs.theme])[key]} onChange={(e) => update({ theme: "custom", custom: { ...(prefs.theme === "custom" ? prefs.custom : editorPalettes[prefs.theme]), [key]: e.target.value } })} /></label>)}
    </div>}
  </div>
}

export function CodeEditor({ value, onChange, settings, label, language = "hcl", readOnly = false, onApply, onDiscard, compact = false, reveal }: { value: string; onChange: (value: string) => void; settings: Settings; label: string; language?: string; readOnly?: boolean; onApply?: () => void; onDiscard?: () => void; compact?: boolean; reveal?: RevealCode }) {
  const element = useRef<HTMLDivElement>(null)
  const instance = useRef<EditorInstance | null>(null)
  const syncing = useRef(false)
  const latest = useRef({ value, onChange, onApply, onDiscard, readOnly })
  latest.current = { value, onChange, onApply, onDiscard, readOnly }
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  const [generation, setGeneration] = useState(0)
  const prefs = editorPreferences(settings.editor)
  const palette = prefs.theme === "custom" ? prefs.custom : editorPalettes[prefs.theme]
  useEffect(() => {
    if (!reveal || state !== "ready") return
    const editor = instance.current
    editor?.focus()
    const matches = reveal.query ? editor?.getModel()?.findMatches(reveal.query, false, false, true, null, false, 2) : undefined
    const match = matches?.length === 1 ? matches[0] : undefined
    if (match) { editor?.setSelection(match.range); editor?.revealRangeInCenter(match.range) }
  }, [reveal?.id, state, generation])

  useEffect(() => {
    let cancelled = false
    let editor: EditorInstance | undefined
    let subscription: Disposable | undefined
    void loadMonaco().then((monaco) => {
      if (cancelled || !element.current) return
      editor = monaco.editor.create(element.current, { value: latest.current.value, language, readOnly: latest.current.readOnly, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontFamily: "'JetBrains Mono', Consolas, monospace", tabSize: 2, ariaLabel: label + ". Tab indents; press Ctrl+M to make Tab move focus out of the editor.", padding: { top: 10, bottom: 10 } })
      instance.current = editor
      subscription = editor.onDidChangeModelContent(() => { if (!syncing.current) latest.current.onChange(editor!.getValue()) })
      editor.addAction({ id: "forge.applyCode", label: "Apply code to diagram", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], precondition: "!editorReadonly", run: () => { if (!latest.current.readOnly) latest.current.onApply?.() } })
      editor.addAction({ id: "forge.discardCode", label: "Discard code changes", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR], precondition: "!editorReadonly", run: () => { if (!latest.current.readOnly) latest.current.onDiscard?.() } })
      setState("ready")
      setGeneration((n) => n + 1)
    }).catch(() => { if (!cancelled) setState("error") })
    return () => { cancelled = true; subscription?.dispose(); const model = editor?.getModel(); editor?.dispose(); model?.dispose(); instance.current = null }
  }, [attempt, label, language])

  useEffect(() => {
    if (instance.current && instance.current.getValue() !== value) {
      syncing.current = true
      try { instance.current.setValue(value) } finally { syncing.current = false }
    }
  }, [value, state, generation])

  useEffect(() => {
    if (!instance.current || state !== "ready") return
    void loadMonaco().then((monaco) => {
      monaco.editor.defineTheme("forge-user", { base: prefs.theme === "light" ? "vs" : prefs.theme === "contrast" ? "hc-black" : "vs-dark", inherit: true, rules: [{ token: "", foreground: palette.foreground.slice(1) }, { token: "comment", foreground: palette.comment.slice(1) }, { token: "keyword", foreground: palette.keyword.slice(1) }, { token: "string", foreground: palette.string.slice(1) }], colors: { "editor.background": palette.background, "editor.foreground": palette.foreground, "editorLineNumber.foreground": palette.comment, "editorCursor.foreground": palette.foreground } })
      monaco.editor.setTheme("forge-user")
      instance.current?.updateOptions({ fontSize: prefs.fontSize, lineHeight: Math.round(prefs.fontSize * 1.55), readOnly })
    })
  }, [prefs.theme, prefs.fontSize, palette.background, palette.foreground, palette.comment, palette.keyword, palette.string, readOnly, state, generation])

  return <><div className="editor-toolbar" role="group" aria-label="Code editor actions">
    <span className="chip">{language === "hcl" ? "Terraform HCL" : language === "json" ? "JSON" : "Text"}{readOnly ? " · read only" : ""}</span>
    <button className="btn small" disabled={state !== "ready"} title="Find (Ctrl/Cmd+F)" onClick={() => { void instance.current?.getAction("actions.find")?.run() }}>Find</button>
    {!readOnly && <button className="btn small" disabled={state !== "ready"} title="Find and replace (Ctrl/Cmd+H)" onClick={() => { void instance.current?.getAction("editor.action.startFindReplaceAction")?.run() }}>Replace</button>}
    {!readOnly && onApply && <span className="faint" style={{ fontSize: 11 }}>Ctrl/Cmd+S apply · Ctrl/Cmd+Shift+R discard</span>}
  </div><div className={`forge-code-editor ${compact ? "compact" : ""}`} style={{ background: palette.background, color: palette.foreground }}>
    <div ref={element} className="monaco-host" style={{ visibility: state === "ready" ? "visible" : "hidden" }} />
    {state !== "ready" && <div className="editor-fallback">
      {state === "error" && <div role="status" className="editor-load-error">Using basic editor. <button className="btn small" onClick={() => { setState("loading"); setAttempt(attempt + 1) }}>Retry advanced editor</button></div>}
      <textarea aria-label={label} spellCheck={false} value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={{ color: palette.foreground, fontSize: prefs.fontSize, lineHeight: 1.55 }} onKeyDown={(e) => {
        if (readOnly || !(e.ctrlKey || e.metaKey)) return
        if (e.key === "Enter" || e.key.toLowerCase() === "s") { e.preventDefault(); onApply?.() }
        else if (e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); onDiscard?.() }
      }} />
    </div>}
  </div></>
}
