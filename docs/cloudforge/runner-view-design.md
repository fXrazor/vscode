# CloudForge Runner View

Proposed design for the Code OSS desktop, 17 November 2026. The pasted brief supplies the product direction. The first slice, interaction details and performance targets below are proposals for review.

## User outcome

From one view, a user can see what CloudForge is checking, what has finished, which dependencies are blocking work, and what to do about a finding. The canvas shows execution against the architecture. The timeline records the order and duration of work. Selecting a resource connects its status to the evidence and, where available, the source.

## First slice

Start with offline, deterministic validation of one selected, saved Terraform architecture. Support a directly opened Terraform root. Also support linked project architectures when the integrated project broker exposes the same authorized graph read. Use three stages: read the architecture, map dependencies, and run static checks. Initial checks cover parse failures, unresolved references where resolvable within the supported source scope, and cycles in verified dependencies. A partial graph or unsupported construct produces an explicit coverage notice. A missing provider schema, external module, or ambiguous reference cannot yield a passing result for the checks that require it.

The existing CloudForge Resources tree and revision-checked source navigation provide the entry points. The current service contract covers guarded graph reads and uses one outstanding stdio request at a time. Runner operations require an approved extension to the canonical Rust contract. [Desktop handoff](../../HANDOFF.md) · [Service contract](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md)

## Workbench experience

1. **Start.** Invoke **CloudForge: Validate Architecture** from the Resources view, the selected architecture in Projects, or the Command Palette. Resolve the authorized selection and show the architecture in the Runner tab. Prompt to save relevant dirty editor buffers before starting. A second invocation opens the active run and offers cancellation through the same control.
2. **Follow.** An editor webview shows execution summary above the React Flow canvas and a findings inspector on the right. The dockable **Runner Timeline** shows stages, events and resource operations with start, elapsed and finish times. Show a percentage only when the service knows the total work, and show an ETA only when the service supplies a supported estimate. Use an indeterminate indicator during discovery.
3. **Investigate.** Select a node or use a searchable keyboard-accessible resource list to see check results, blockers and remediation guidance. **Open Source** uses the trusted navigation path and rechecks the revision. Keep the terminal overlay on the graph after completion. Findings with safe locations can appear in native Problems for the current revision.
4. **Recover.** Closing a Runner tab leaves the run available in the same window. On an input edit, show that results refer to the captured revision and disable stale location actions. Cancel and clear the run when its authorized scope is revoked. After a service exit, mark the visible run interrupted and offer a fresh validation when the service is available. Keep the current or most recent run for the active scope in memory.

| Node state | Visual treatment | Meaning |
| --- | --- | --- |
| Pending | Grey and waiting label | Work is queued. Name a prerequisite when one is known. |
| Running | Blue and running label, with a restrained pulse | A check is active. Animate only visible execution edges that the service has confirmed are active. |
| Success | Green and passed label | Applicable checks passed within displayed coverage. |
| Warning | Amber and warning label | A check reported an actionable warning. |
| Failed | Red and failed label | A check found an error. Include its finding. |
| Skipped | Muted grey and skipped label | A failed prerequisite, unsupported input, or cancellation prevented the check. Include the reason. |

Show completed execution edges in a stable highlight and failed or blocked edges with a status marker. Keep containment and inferred references visually distinct from verified blockers. Give every status a text label and icon, honor reduced motion, and announce stage changes or completion through a summary. Keep keyboard focus stable as events arrive. The run summary distinguishes completion with warnings or errors, incomplete coverage, cancellation and interruption.

## Execution and data ownership

Use a **Rust background run with cursor-based progress batches**. A fast start request schedules execution. Short reads return bounded events since a cursor, so cancellation and graph requests can use the existing serialized connection. A push channel could lower progress latency, but it would require changes to framing dispatch, backpressure and lifecycle. Review it against measured latency before changing the transport.

- **Rust service** owns the immutable inputs, scope checks, dependency analysis, validation, event sequencing and cancellation. Capture guarded source once for each run, tie it to the exact source revision, and reject a mismatched requested revision. Use bounded worker concurrency. Run independent work even when another branch fails. Report a cycle against its members and block only work that requires the cycle to resolve.
- **Electron-main broker** authorizes calls against the originating window and active scope. It binds run handles to that service instance and revokes them when the scope changes or the window closes. The extension receives display-safe projections and opaque handles.
- **Built-in TypeScript extension** owns the command, run state and Workbench views. Patch state by run and node ID, ignore duplicates, and request a compact authoritative snapshot if a cursor gap cannot be replayed. Webviews receive sanitized data and send narrow selection or control intents. Bundle the canvas assets locally and apply a restrictive webview content security policy.

Hold one active validation run per grant. A bounded sequence of events covers run and stage lifecycle, node transitions, findings and final outcome. Include identifiers, a monotonic sequence, timestamps or durations, and nullable progress when it is measurable. Define count and byte limits for events, snapshot pages and diagnostics. Oversized or incomplete data gets an explicit coverage state. Reject stale or foreign handles and prevent a late update from overwriting the terminal state of a cancelled run. Send typed codes, safe messages and vetted locations. Keep raw source, absolute paths, credentials, resource values and raw process output outside the UI payload. The integration owner defines the exact capability negotiation, public method names and limits in the canonical Rust protocol after approval.

Block work at the check level. A prerequisite blocks only checks that need its output, so a cycle can fail dependency validation while syntax checks still report their results. Use node IDs from the graph produced from the captured inputs. Enable source navigation only when a fresh trusted graph read confirms the same revision and resolves the same node and location. Reinvoking validation for the active architecture focuses its run, with a separate **Cancel Run** action. Selecting a different authorized architecture revokes and cancels the previous run before a new one starts.

## Scale and responsiveness

Group collapsed modules and show status counts across hidden work. Load expanded or nearby graph groups on demand. Keep node positions stable while execution progresses. Coalesce updates by node and edge, keep independent UI selections stable, and move costly layout off the webview thread if profiling shows stalls. Benchmark React Flow viewport culling with the projected graph, as culling incurs overhead and does not bound the service payload. [React Flow viewport API](https://reactflow.dev/api-reference/react-flow) · [Large graph performance](https://reactflow.dev/learn/advanced-use/performance)

Use an installed Windows x64 build and a declared test machine. Proposed initial fixture targets are 1,200 nodes and 6,000 edges, matching the current parser caps. Aim for first visible status within 1 second of service acceptance, event-to-visible update within 500 ms at the 95th percentile, and frame times below 32 ms at the 95th percentile during pan and zoom in the fixture. Measure the collapsed and expanded states. Treat coverage past the parser caps as a separate service scalability milestone.

## Later execution modes

| Mode | Runner additions | Required execution decision |
| --- | --- | --- |
| Expanded validation | Naming, security and compliance rules, Terraform linting and cost coverage | Establish rule provenance, configuration, and permission for any provider lookup or external tool. Surface coverage by rule. |
| Generation | Show each component and artifact as Terraform, Bicep, ARM, CloudFormation, Kubernetes or documentation is generated. Inspect proposed changes and fixes. | Define staged artifacts, a reviewable diff, and a revision-checked apply operation with explicit write authorization. |
| Deployment | Separate Plan, Apply, resource operations, state updates and verification. Show queued, active and blocked operations. | Define managed process ownership, credentials, redaction, plan identity, explicit apply authorization, and cancellation or interruption semantics. |
| AI analysis | Show named Architecture, Security, Cost, Best Practices and Compliance agents. Display current task, available progress, ETA and generated outputs. | Define provider and data scope, evidence provenance, and how competing or stale outputs are reviewed. Show unavailable progress fields as such. |

Playback, time-travel debugging, agent collaboration graphs and historical deployment heatmaps require an event retention and privacy design.

## Acceptance for the first slice

- A saved fixture with independent resources, a verified dependency chain, a failed prerequisite and a cycle shows accurate status, the reason for each blocked node, and useful work continuing on the independent branch.
- A partial graph reports the checks that could run and visible gaps. A user can open a safe finding location before an input edit and gets a clear stale result after an edit.
- A run remains inspectable after switching tabs or reopening the webview. Duplicate events, cursor gaps, cancellation, competing windows, root changes and service exit resolve to the correct run and state.
- Keyboard navigation reaches the same findings as node selection. Reduced motion preserves the status and blocking cues. The scale fixture meets the measured responsiveness targets or records the shortfall before acceptance.
- The matched installed app validates offline. Fixture source and workspace files match before and after. Other windows cannot use the run handles, safe payload fixtures contain no sensitive values, and window close or forced desktop termination leaves no sidecar or worker running.

## Review and handoff

Approve the first slice and choose one named integration owner before implementation. The owner then defines the Runner capability in the canonical Rust protocol, records limits and fixtures, and coordinates separate desktop and Rust worktrees. The desktop owner delivers the built-in Runner UI and narrow broker changes. The Rust owner delivers guarded execution and lifecycle. The integration owner pins the matched desktop and service revisions and exercises the installed Windows acceptance checks.
