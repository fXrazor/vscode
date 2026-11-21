export type EditorTheme = "dark" | "light" | "ocean" | "contrast" | "custom"

export interface EditorPalette {
  background: string
  foreground: string
  comment: string
  keyword: string
  string: string
}

export interface EditorPreferences {
  theme: EditorTheme
  fontSize: number
  custom: EditorPalette
}

export const editorPalettes: Record<EditorTheme, EditorPalette> = {
  dark: { background: "#1e1e1e", foreground: "#d4d4d4", comment: "#7ca668", keyword: "#569cd6", string: "#ce9178" },
  light: { background: "#ffffff", foreground: "#24292f", comment: "#57606a", keyword: "#0550ae", string: "#a31515" },
  ocean: { background: "#0f172a", foreground: "#e2e8f0", comment: "#94a3b8", keyword: "#7dd3fc", string: "#a7f3d0" },
  contrast: { background: "#000000", foreground: "#ffffff", comment: "#a8ff60", keyword: "#ffff00", string: "#00ffff" },
  custom: { background: "#1e1e1e", foreground: "#d4d4d4", comment: "#7ca668", keyword: "#569cd6", string: "#ce9178" },
}

export const defaultEditor: EditorPreferences = { theme: "dark", fontSize: 13, custom: editorPalettes.custom }

export function editorPreferences(value?: Partial<EditorPreferences>): EditorPreferences {
  const theme = value?.theme && Object.hasOwn(editorPalettes, value.theme) ? value.theme : defaultEditor.theme
  const custom = { ...defaultEditor.custom }
  for (const key of Object.keys(custom) as (keyof EditorPalette)[]) {
    const color = value?.custom?.[key]
    if (typeof color === "string" && /^#[a-f\d]{6}$/i.test(color)) custom[key] = color
  }
  return { theme, fontSize: typeof value?.fontSize === "number" && Number.isFinite(value.fontSize) ? Math.max(10, Math.min(28, Math.round(value.fontSize))) : defaultEditor.fontSize, custom }
}
