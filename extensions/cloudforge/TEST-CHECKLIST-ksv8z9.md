# CloudForge: test checklist for branch `claude/project-thread-ksv8z9`

Covers everything built in both repos on 25 November 2026 (updated 17:30 for three-way saves and file values) (Rust `fXrazor/CloudForge` and Code OSS `fXrazor/vscode`, same branch name). Nothing is merged yet.

## 0. Build and automated checks (Windows)

- [ ] Rust: in a checkout of the branch, from `service/`, with a **fresh** `CARGO_TARGET_DIR` (a stale one gives bogus `hcl-edit` E0599 errors), run `cargo test`. Expect everything to pass, including the `focused_save` (14) and `resource_values` (1) unit tests and, in `tests/draft_save.rs`, `focused_save_rewrites_only_changed_values_and_keeps_comments` and `read_resource_values_returns_file_values_without_secrets`.
- [ ] Rust: `node docs/protocol/fixtures/check-fixtures.mjs` reports the fixtures consistent.
- [ ] Code OSS: build with the new service binary staged, then run the electron-main test `src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts`.
- [ ] Code OSS: full type-check (`npm run compile` or the usual watch build). This covers `cloudForgeService.contribution.ts`, which couldn't be checked in the cloud.
- [ ] Studio: `pnpm check` and tests (105 expected) in `extensions/cloudforge/studio`; extension tests (70 expected).

Use a test project with at least two architectures and one `.tf` file that has comments, a `tags = local.tags` line, a `lifecycle` block and a `dynamic` block.

## 1. Projects and architectures

- [ ] **New Architecture** (Projects view): creates `architectures/<name>/main.tf` and opens it on the canvas.
- [ ] New Architecture with a name that already exists, in any letter case: shows "An architecture with that name already exists".
- [ ] **Use Template**: creates the architecture with the template files and opens it.
- [ ] **Browse Project Architectures** (layout icon in the Projects view title): one card per architecture, with resource, data and module counts, provider chips and "edited N min ago".
- [ ] Gallery search (by name, repository, provider), the three sort options, and Refresh all work.
- [ ] Clicking a card opens that architecture. New Architecture and Templates buttons work from the gallery.
- [ ] An empty architecture shows "No Terraform files yet". A deleted folder shows as unavailable, without an error dialog.

## 2. Clickable warnings and errors (Issues panel)

- [ ] Two overlapping networks: the warning points at both. Clicking it fits both on the canvas and opens the address field. There's a button for each network.
- [ ] Run checks (validate) with a broken `.tf` file: the finding shows **Open main.tf:LINE**, and it opens the editor at that line.
- [ ] Edit the file after the check: the finding shows **Stale** with **Run checks again**. Opening its location shows the "earlier version" notice.

## 3. Palette and resource forms

- [ ] Import a provider schema (**Import Provider Schema**). Types not in the bundled catalogue appear in the palette labelled "Imported schema <version>".
- [ ] Select a resource with an imported schema: the form shows "Full visual coverage · N schema paths", or a list of paths that need HCL.

## 4. Provider schema check (Code tab)

- [ ] Select a resource with an imported schema and open the **Code** tab. Within about a second it shows "Matches the provider schema · checked against provider X", or "N schema errors" with the field paths.
- [ ] Clear a required field in the form: an error appears for that path. Fill it in again and the error clears.
- [ ] Expand "Terraform rendered from the provider schema": the HCL matches the resource.
- [ ] A resource without an imported schema shows no schema check strip.

## 5. Saving from the canvas (focused saves)

- [ ] Change one value on the canvas and choose **Save main.tf**. The dialog lists "Updates <address>", "Keeps N other blocks exactly as written" and "Comments and fields the canvas does not show are kept".
- [ ] Apply. In the file, only that value changed. Comments, `tags = local.tags`, `lifecycle`, `dynamic`, blank lines and line endings (CRLF) are unchanged.
- [ ] Add a resource on the canvas and save: it's appended at the end of the file, and the dialog says "Adds <address>".
- [ ] Delete a resource on the canvas and save: the dialog says "Removes <address>", and the block is gone from the file with no blank stub left behind.
- [ ] Rename a resource on the canvas and save: the dialog says "Renames A to B and adds a moved block". The original block keeps its comments and fields with the new name, and a `moved { from = A  to = B }` block is appended.
- [ ] Save with no changes: the dialog says "No changes to write", and applying leaves the file byte for byte the same.
- [ ] Break the syntax of the file on disk, then save from the canvas: the dialog falls back to the whole-file preview (no merge summary) and can still save.
- [ ] Edit the file in the code editor after previewing, then Apply: you get the "source changed" notice, and nothing is written.
- [ ] Put a password literal in a field: the dialog shows a SENSITIVE_LITERAL finding without showing the value.
- [ ] After a save, the graph refreshes and **Undo** on the canvas still works.

## 6. The canvas shows what the files say

- [ ] Open an architecture whose `.tf` sets a non-default `location` (for example `westeurope`) and a resource `name`. The canvas form shows those values, not the catalogue defaults.
- [ ] A field written as an expression (for example `var.location`) keeps the canvas value, and saving leaves the expression in the file untouched.
- [ ] A `password` or `secret` attribute never shows its value on the canvas.
- [ ] Edit something on the canvas quickly while the architecture is still loading. Your edit isn't overwritten when the file values arrive.

## 7. Saves write only what you changed (three-way)

- [ ] Open an architecture, change only one field on one resource, and save. In the file, only that one value changed, even for fields where the canvas showed a default.
- [ ] Delete a field on the canvas (clear it or remove the setting) and save. That line, including its trailing comment, is removed from the file.
- [ ] Delete a nested block (for example an `ip_configuration`) on the canvas and save. That block is removed from the file.
- [ ] Refresh the graph after a save: the next save starts from the new file contents.

## 8. Known gaps (not bugs)

- If the graph refreshes while you have unsaved canvas edits, those edits count as already saved for the next three-way save. Save before refreshing.
- Moving a resource from one file to another isn't supported by focused saves.
- The schema check appears in the inspector's Code tab, not in the focused workspace's code pane.
