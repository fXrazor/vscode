# Guided variable collection values — 26 November 2026

## Checkpoint and scope

Source checkpoint: **`28af238269e42fd9032f74b358ad931ec8677627`**, branch **`codex/guided-variable-values`**, worktree **`C:/Users/dalep/.codex/worktrees/guided-variable-values/CloudForge-Code`**. Integration owner: Codex. Based on freshly fetched `origin/main` **`e14d0b22b1a`**, including Claude's merged Miro-style controls, per-entry list bindings and wider resource editor. This checkpoint is local; it has not been pushed or merged.

Dale requested another feature after closing the provider-mirror work, then emphasized preserving Claude's merged Studio work. The selected addition completes guided value entry for non-sensitive `list(string)` and `map(string)` variables in the existing Variables configurator. Resource list fields already have Claude's per-entry Value / Variable / Reference controls; those files and renderer behavior are outside this change.

## Design and acceptance

Keeping JSON as the only input made learners write array/object syntax for representable values. A separate manager would add persistent UI and duplicate the current flow. The chosen design uses the existing literal-entry, dashed Add, remove and quiet JSON-action styles within the existing value sections.

- Default and architecture override retain separate text drafts owned by `VariablePanel`.
- Entry fields and JSON edit that same text. Both use the existing `parseVariableInput` / `variableError` validation; no new coercion or expression evaluator is introduced.
- Opening fields or changing representation does not initialize a value. Empty collection, null and disabling the value checkbox remain distinct, explicit actions.
- List order, empty strings, Unicode and quotes survive mode changes and removal. Map keys are unique; adding an existing key cannot replace its value. Special keys such as `__proto__` and existing empty keys remain ordinary editable entries.
- Invalid or differently typed JSON stays visible for correction. Returning to fields requires valid text and the explicit action.
- Sensitive collections keep the existing password input and hidden effective-value preview. They do not expose entry fields. Object and `any` values retain their existing JSON controls.
- Native labels/buttons remain keyboard operable. Removal returns focus to Add for lists or the new-key input for maps. Long keys wrap; actions fit the existing light/dark and responsive panel layout.
- Only the existing Save variable action changes the canonical architecture and semantic Undo history. Cancel preserves the saved variable. No service, protocol, authorization, provider, installer or architecture-model changes are included.

Files: `src/VariableCollectionInput.tsx`, `src/VariableConfigurator.tsx`, `src/variableInputs.ts`, three scoped rules in `src/editor-refinement.css`, and `scripts/variable-collections-verify.ts`.

## Fresh verification

The following ran against the source contents committed as `28af238269e42fd9032f74b358ad931ec8677627`, with Node **24.22.1** and the checkout's pinned pnpm **12.16.0**. Studio dependencies were installed frozen in this worktree; application `node_modules` were not shared.

| Check | Result |
| --- | --- |
| Studio `corepack pnpm run check` | Passed |
| Standalone verification-runner TypeScript check, command below | Passed |
| Studio `corepack pnpm run test` | **229/229**, no failures or skips |
| Studio `corepack pnpm run build` | Passed |
| Windows Edge browser preview runner | **39/39**, no console/page errors |
| Strict oxlint on new collection component, input helper and runner | Passed, no warnings/errors |
| Modified `VariableConfigurator.tsx` full-file oxlint | 53 existing JSX-string localization warnings, zero errors; identical warning count/rule to `HEAD` before this feature |
| `git diff --cached --check` | Passed |

Root lint dependencies are absent in this isolated checkout. Targeted lint used the existing executable and configuration at `Z:/CloudForge-Code/node_modules/.bin/oxlint.cmd` and `Z:/CloudForge-Code/oxlint.config.ts`, with explicit paths to this worktree's files. No lint rules were suppressed or repository configuration changed. `output/lint/baseline.json` and `current.json` preserve the comparison for the existing configurator warnings.

The browser runner operates the real preview UI, Save, canonical architecture JSON export, Undo and Redo. It verifies collection typing, rejected drafts, JSON recovery, duplicate/special/empty map keys, independent overrides, sensitive masking, Cancel, explicit unset, keyboard focus, retained drafts when reopening, and screenshots at **1440×1000**, **1024×768**, **390×844**, in light and dark themes. This is browser-preview evidence, not installed Workbench/service proof.

Reproduce from the Studio directory:

```powershell
corepack pnpm run dev # use the printed loopback URL in another terminal
$env:PLAYWRIGHT_DIR = 'Z:/CloudForge-Code' # external automation tooling only
$env:PLAYWRIGHT_EXECUTABLE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/variable-collections-verify.ts http://127.0.0.1:<printed-port>/
corepack pnpm exec tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node scripts/variable-collections-verify.ts
```

Local screenshots and results: `output/playwright/variable-collections/`. A copy of the six screenshots, result list, Studio test output and lint comparison is preserved outside the worktree at `C:/Users/dalep/.codex/visualizations/2026/11/26/01a216e1-525e-74f0-a26e-e7a5d5728866/guided-variable-values/`.

## Next action

Review this local checkpoint against current `origin/main` before any requested integration. After integration, verify list/map defaults and architecture overrides in the installed desktop with the current packaged extension, particularly sensitive values and the existing guarded file-save flow. No installed app files or installer were changed here. Arbitrary nested object/`any` variable forms, map-key renaming and drag reordering are outside this checkpoint; the existing JSON editor remains available. Preserve the canonical Studio continuation's remaining provider and Technical Graph work.
