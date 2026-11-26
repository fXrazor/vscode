# CloudForge: test checklist for branch `claude/project-thread-ksv8z9`

Covers everything built in both repos on 25 November 2026 (updated for three-way saves, file values, saving several files at once, the side panel and the cloud sign-in check) (Rust `fXrazor/CloudForge` and Code OSS `fXrazor/vscode`, same branch name). Merged into `main` in both repos on 25 November 2026 (evening), together with the newer work already on main (Stage 9B plan, Stage 10 offline mirror, Terraform language features, CloudForge branding).

## 0. Build and automated checks (Windows)

- [ ] Rust: in a checkout of the branch, from `service/`, with a **fresh** `CARGO_TARGET_DIR` (a stale one gives bogus `hcl-edit` E0599 errors), run `cargo test`. Expect everything to pass, including the `focused_save` (14) and `resource_values` (1) unit tests and, in `tests/draft_save.rs`, `focused_save_rewrites_only_changed_values_and_keeps_comments`, `read_resource_values_returns_file_values_without_secrets` and `focused_batch_saves_several_files_under_one_token`. `tests/stage11_state_connections.rs` (it writes and then deletes one generic credential in your Credential Manager, and runs `az account show` once if the Azure CLI is installed). `fixtures.rs` expects 22 Stage 2 fixtures, including `create-architecture-adopt-root-files`. `tests/stdio.rs` now expects the 2 MiB request limit.
- [ ] Rust: `node docs/protocol/fixtures/check-fixtures.mjs` reports the fixtures consistent.
- [ ] Code OSS: build with the new service binary staged, then run the electron-main test `src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts`.
- [ ] Code OSS: full type-check (`npm run compile` or the usual watch build). This covers `cloudForgeService.contribution.ts`, which couldn't be checked in the cloud.
- [ ] Studio: `pnpm check` and tests (139 expected after merging main) in `extensions/cloudforge/studio`; extension tests (96 expected).

Use a test project with at least two architectures and one `.tf` file that has comments, a `tags = local.tags` line, a `lifecycle` block and a `dynamic` block.

## 1. Projects and architectures

- [ ] **New Architecture** (Projects view): creates `architectures/<name>/main.tf` and opens it on the canvas.
- [ ] New Architecture with a name that already exists, in any letter case: shows "An architecture with that name already exists".
- [ ] **Use Template**: creates the architecture with the template files and opens it.
- [ ] **Browse Project Architectures** (layout icon in the Projects view title): one card per architecture, with resource, data and module counts, provider chips and "edited N min ago".
- [ ] Gallery search (by name, repository, provider), the three sort options, and Refresh all work.
- [ ] Clicking a card opens that architecture. New Architecture and Templates buttons work from the gallery.
- [ ] An empty architecture shows "No Terraform files yet". A deleted folder shows as unavailable, without an error dialog.

## 1b. Moving root Terraform files into an architecture

- [ ] Put `main.tf` and `outputs.tf` in a project's root folder, then run New Architecture and pick "Move 2 Terraform file(s) from project root". The files appear in `architectures/<name>/`, are gone from the root, and the new architecture opens on the canvas.
- [ ] Repeat, but edit a root file while the name prompt is open and save it before confirming. The architecture gets the old copy and the edited root file stays, with a warning naming it.
- [ ] The "Terraform files found in the root" prompt's Create Architecture… button does the same move.

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
- [ ] A field written as exactly `var.NAME` shows as bound to the variable NAME on the canvas, and the variables panel lists the `variable` blocks from your files (type, description, default; a sensitive default is never shown).
- [ ] Other expressions (for example `azurerm_resource_group.rg.location`) keep the canvas value, and saving leaves the expression in the file untouched.
- [ ] A `password` or `secret` attribute never shows its value on the canvas.
- [ ] Edit something on the canvas quickly while the architecture is still loading. Your edit isn't overwritten when the file values arrive.

## 7. Saves write only what you changed (three-way)

- [ ] Open an architecture, change only one field on one resource, and save. In the file, only that one value changed, even for fields where the canvas showed a default.
- [ ] Delete a field on the canvas (clear it or remove the setting) and save. That line, including its trailing comment, is removed from the file.
- [ ] Delete a nested block (for example an `ip_configuration`) on the canvas and save. That block is removed from the file.
- [ ] Refresh the graph after a save: the next save starts from the new file contents.

## 7b. Save every changed file at once

- [ ] Change resources in two different `.tf` files, then press Save in the top bar. A "Save canvas changes" dialog lists both files, each with what changes ("Updates …", "keeps … as written").
- [ ] Press "Save 2 files". Both files change on disk, nothing else does, and the graph refreshes to the new revision.
- [ ] Change only one file and press Save: the usual single-file dialog opens for that file.
- [ ] In the save-all dialog, press Review on one file: the single-file dialog opens for it.
- [ ] Edit one of the files in the code editor after previewing, then press Save in the dialog. It refuses (source changed) and writes nothing.
- [ ] Move a resource to another file (change its source file on the canvas, if your build offers it) and save all: it is removed from the old file and added to the new one, which is created if needed.
- [ ] A large architecture (several hundred resources) still previews and saves (requests up to 2 MiB).

## 7c. Canvas and files stay in step

- [ ] Edit a field on the canvas and don't save. In the code editor, change a different value of the same resource in the `.tf` file and save the file. The canvas shows the new file value and still has your canvas edit.
- [ ] Press Save: your canvas edit is written (it was not lost by the refresh).
- [ ] Change the same field in both places: the file value wins on the canvas.
- [ ] After saving, the top bar no longer shows unsaved changes once the refresh arrives, including for fields written as expressions.
- [ ] Undo after a refresh: your canvas steps undo, and the file change stays.
- [ ] Change a `.tf` file outside Code OSS (for example `git checkout` of another version, or edit it in Notepad). The canvas refreshes on its own within a second.

## 9. CloudForge side panel

- [ ] A CloudForge icon appears in the activity bar. Its panel holds Project Status, Projects, CloudForge Graph, Terraform State and Cloud Connections. Projects and CloudForge Graph are still in Explorer too, and both copies stay in step (open, refresh, select).
- [ ] Project Status lists the project, architecture and revision, resources, checks (click opens Problems) and the state line. If the architecture uses Azure resources and Azure isn't linked, an Azure row shows a warning.
- [ ] "Open Project Status" opens a tab. Refresh, Open canvas, Run checks, Link and Store key all work from it.
- [ ] Terraform State, with no backend block and no state file: "Backend local (default)" and "No local state file".
- [ ] Copy a real `terraform.tfstate` into an architecture folder. Serial, Terraform version, resources (clicking one with a matching block opens its source), outputs (sensitive ones show a lock) and "Differences from configuration" appear. No attribute or output value shows anywhere.
- [ ] Add `terraform { backend "azurerm" { … } }`. The backend shows `azurerm` and its setting names only. After `terraform init` with a different backend, "Initialized backend differs" appears.

## 10. Cloud connections

- [ ] Run `az login`, then Link Cloud Account → Azure. Enter the tenant and subscription from `az account show`. The row shows "subscription …abcd" (masked).
- [ ] Link AWS with a profile name and region, and Google with a project ID.
- [ ] Store Key for AWS (access key ID plus secret). The secret box is masked. Afterwards the row says "key stored", and Windows Credential Manager → Generic Credentials has `CloudForge/<numbers>/aws`.
- [ ] `%LOCALAPPDATA%\CloudForge\service\cloud-connections.json` holds the bindings and no key. Nothing new appears in the project folder or its git status.
- [ ] Delete Stored Key removes the credential; Unlink removes the binding and any key.
- [ ] Close and reopen the project, including after renaming or moving its folder: the links are still there.
- [ ] The Azure, AWS and Google rows no longer say "not found" when the CLI is installed in its usual place (it used to always say so).

## 10b. Check cloud sign-in

- [ ] With `az login` done and Azure linked to the same tenant and subscription, click the check icon on the Azure row (or "Check sign-in" in the Project Status tab). The row spins, then shows "Signed in" with a green tick; the tooltip shows "Signed in as d…@yourdomain · <subscription name>". The full email, tenant and subscription IDs never appear.
- [ ] Run `az account set` to another subscription, or link a subscription you can't see: the check says "Signed in elsewhere" or "No access" with a warning icon.
- [ ] Run `az logout` and check again: "Not signed in". Pick "Type Command in Terminal": a "CloudForge sign-in" terminal opens with `az login` typed but **not** run.
- [ ] AWS: with a valid profile you get "Signed in as account …1234". With an expired SSO profile you get "Sign-in expired" and the terminal offer types `aws sso login --profile <name>`. With a misspelt profile you get "Profile missing".
- [ ] Google: after `gcloud auth login` and `gcloud config set project <linked id>` you get "Signed in". Point gcloud at another project and you get "Signed in elsewhere".
- [ ] Uninstall or rename the CLI folder: "CLI not found". Unplug the network: the check ends within about 25 seconds with "No answer" and CloudForge stays responsive afterwards.
- [ ] Task Manager shows no `az`, `python`, `aws` or `gcloud` process left after a check.
- [ ] Linking a provider offers "Check Sign-In" in the confirmation. Changing the link, storing a key or switching project clears the old result.

## 8. Known gaps (not bugs)

- Moving a resource between files works only through Save all (both files in one save); the single-file save still keeps the old block.
