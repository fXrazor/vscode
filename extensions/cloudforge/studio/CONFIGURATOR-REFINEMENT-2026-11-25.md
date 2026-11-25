# Variable configurator and resource workspace refinement

Approved scope: the user's two design annotations, plus the follow-up request for backdrop/X dismissal. Preserve the established Inter, white/violet and independent dark-theme system. This is a focused Operate-surface refinement, not a new visual identity.

## Implementation direction

- Variable configuration: separate identity, type, fallback/default, architecture override and sensitivity; use examples and a small effective-value explanation to teach precedence. Keep unset distinct from empty string, false and zero. Architecture is the only supported scope; do not imply environment/project scope or new validation infrastructure.
- Reuse the current variable model, local editor draft, save/import/filter/history behavior and export redaction. Choose text, boolean, number and JSON controls from the existing supported types. Keep guidance tied to each field, with advanced explanation collapsible.
- Resource workspace: improve pane headings, spacing and parameter hierarchy; show useful existing relationships and contained resources rather than repeated empty sections. Keep code on the left, shared form in the middle and optional context on the right. Preserve source-code drafts and resize controls.
- Dismissal: always-visible top-right Close, backdrop click and Escape return to the canvas. Backdrop dismissal must start and end outside the dialog, so dragging from a field or resize handle cannot accidentally close it. Closing preserves unapplied HCL and variable drafts.
- Checkpoint: append a dated addendum to the existing checkpoint and retain its original bytes and remaining-work list. Full provider schemas, resource reference pickers and all other open items remain open.

## Verification

Paused at the user's explicit request on 25 November 2026, with implementation saved for feature-branch push. Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`; branch: `codex/infrastructure-studio-preview`; starting revision: `e90aec47a5f50ca7dbca01799979012cfbf4068c`. Resolve this checkpoint commit with `git log -1 -- extensions/cloudforge/studio/CONFIGURATOR-REFINEMENT-2026-11-25.md`.

Fresh checks: TypeScript passed, **60 tests passed / 0 failed**, and production preview build passed after the final source edits. Two new tests cover typed variable parsing, empty text/false/zero/null preservation, supported JSON shapes, invalid values and one-step save/Undo. No dependencies, provider contracts, source checkouts, Rust service or packaged Workbench files were changed.

The embedded CUA connection remains closed. REA successfully launched a separate headless Chrome with an owned temporary profile against the in-memory sample; all declared actions completed: opening Variables, creating an unsaved input, entering a name/description, setting a default and an architecture override, and returning focus to the name. Accessibility output confirmed both distinct values and the effective override. Captured console errors: zero. Provider cleanup confirmed `terminated-owned-process`. Evidence: `ev_3f581271fcf581437dddae1501e883beccbf45bd8751bccf2ddecfd58e88dd93`. The user's open preview and reference tabs were not reset or edited.

That first rendered check exposed the Save footer below the fold. The final source fixes ownership of scrolling to the configurator body, keeps the effective-value explanation and Save/Cancel visible, and removes repeated type help. **Those final layout corrections have not been browser-rechecked.** The earlier capture is saved, ignored, at `output/playwright/variable-configurator-initial-2026-11-25.png`; it is evidence of the first version, not the final layout.

## Implementation map

- `VariableConfigurator.tsx`: identity/scope/type hierarchy; typed value controls and examples; default/override explanation; effective-value preview; sensitivity; accessible labels/errors; persistent actions. `VariablePanel` retains existing draft state so switching code/context surfaces does not discard typed values.
- `variableInputs.ts`: shared bounded parsing/feedback uses the existing variable model and validator; no expression evaluation or extra architecture state.
- `ResourceWorkspace.tsx`: pane identity and clearer headings, visible metadata, grouped inherited sources, contained-resource navigation, contextual empty/help states, check navigation, explicit top-right Close and guarded backdrop dismissal. Backdrop press must begin and end outside the dialog; a resize/drag starting inside does not dismiss it. Escape and Back remain available. Closing leaves component/draft state mounted.
- `CodePanel.tsx`: a compact focused-workspace presentation, preserving draft/stale/conflict/apply behavior. The inspector's regular code presentation is retained.
- `editor-refinement.css`: scoped spacing, field states, quiet controls, independent form scrolling, responsive single-pane navigation and both-theme tokens. `preview.tsx` imports it after existing styles.

## Exact resume action for this addendum

1. Run a fresh owned-browser check of the final variable form at desktop and narrow widths: fixed header/actions, effective-value precedence, bool/number/list/map controls, invalid Save and error focus, empty/false/zero/null, sensitivity masking, Save/Cancel and return focus. Check that only the intended body scrolls.
2. Verify the redesigned resource-group workspace and a VM workspace in both themes. Test code/context toggles, metadata editing, grouped inheritance/contained-resource navigation, keyboard focus, pane resize and narrow tabs.
3. **Test all close paths:** top-right X, backdrop click, Back, Escape; reopen and confirm unapplied HCL and unfinished variable edits remain. Test pointer down inside then up outside to ensure dragging/resizing cannot close the workspace accidentally. These paths are implemented but were not exercised before the pause.
4. Capture final screenshots and review the final spacing/contrast. The initial REA scenario is not a substitute for these final checks. Rerun the smallest relevant checks if any fixes are needed.
5. Continue the original checkpoint's remaining work without removing or reordering it: the old per-renderer zoom check, typed resource-attribute pickers, complete provider schemas and all other outstanding items remain open. This addendum makes no claim that those items were completed.

Original checkpoint preservation verified: the first 13974 bytes are unchanged (SHA-256 `1a4581e7160dc0f3988f0fc0f24a9734a32a64816362d36d90499199ca567e8f`).

## Superseded — 25 November 2026 continuation

Every step in the resume list above was completed on `main` after `f82e0c12` merged. Do not resume from this file. Continue from [STUDIO-CONTINUATION-2026-11-25.md](STUDIO-CONTINUATION-2026-11-25.md), which gives the current branch, what changed, verification and the ordered next actions. The content above this section is unchanged.
