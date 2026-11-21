# CloudForge reference investigation — 18 November 2026

The useful adaptation is **CloudLab's infrastructure semantics, CloudForge's existing React Flow projections, and Miro's contextual authoring interactions**. A second architecture store or a replacement canvas engine would discard useful work. Impeccable's Operate guidance applies to the board: precise hierarchy, familiar controls, restrained states and more space for the work.

This pass delivers research and an implementation map. It changes documentation only. It does not implement the roadmap, publish to main, exercise infrastructure, or establish complete parity with either reference product.

## Deliverables

| Requested deliverable | Report |
| --- | --- |
| 1. Feature inventory | [Feature inventory and comparison](feature-inventory.md) |
| 2. UX behaviour inventory | [Interaction sequences](feature-inventory.md#interaction-sequences) and [live evidence](browser-evidence.md) |
| 3. Architecture observations | [Architecture and state](architecture-and-state.md#rendering-and-component-boundaries) |
| 4. Annotation system report | [Annotations](annotations.md) |
| 5. Workflow canvas report | [Canvas workflows](architecture-and-state.md#workflow-canvas) |
| 6. State management report | [State ownership](architecture-and-state.md#state-management) |
| 7. Data model report | [Data model](architecture-and-state.md#data-model) |
| 8. API interaction report | [API evidence and proposed boundaries](api-interactions.md) |
| 9. CloudLab/CloudForge gap analysis | [All 27 annotations mapped](preview-gap-map.md), [provider contracts](provider-contract-map.md) |
| 10. Recommended implementation roadmap | [Roadmap and acceptance criteria](roadmap.md) |

Supporting code archaeology: [CloudLab source ownership, services and hashes](source-archaeology.md). Board direction: [Impeccable design brief](board-design-direction.md).

## Findings that change implementation order

1. **The four canvas implementations are not interchangeable.** Live Brainboard exposes an SVG architecture surface. Live Miro exposes canvas elements with DOM editing overlays. CloudLab source uses a transformed HTML world with SVG lines. This preview uses React Flow. Those observations do not identify either commercial application's private engine.
2. **Preview configuration is much shallower than its catalogue.** Its imported catalogue exposes primitive attributes; resource settings are strings. CloudLab already models typed references, expressions, recursive blocks, file allocation and inheritance. Catalogue counts cannot establish schema coverage.
3. **Drawing lines and infrastructure dependencies need different meaning.** CloudLab derives reference edges from properties and also stores drawing-only edges. The preview currently stores undifferentiated resource connections. Styling a line must never create a Terraform reference implicitly.
4. **The current service boundary is read-only for architecture data.** Stage 1 graph and Stage 2 project contracts exist, but provider schema import, configuration writes, execution and plans remain excluded from the canonical protocol. Reuse fresh trusted source navigation now; treat richer edit contracts as proposals.
5. **Collaboration is an investigation gap, not an installed capability.** Miro sent and received WebSocket frames during the observation window. Payload semantics, durable comment storage and merge algorithm were not established. CloudLab's inspected model has no board-thread/presence entity.

## Evidence and confidence

- **Confirmed:** directly observed in this browser session, user-supplied page evidence, or a cited local source snapshot. Every finding states which kind; source confirmation does not prove a serving build match.
- **Strongly Likely:** a narrow inference supported by observations, with a remaining alternative stated.
- **Possible:** an implementation hypothesis or proposed CloudForge design. This never means the reference uses it.
- **Unknown:** unavailable, untested, blocked or not distinguishable from the evidence.

`BB-*` and `MI-*` refer to this pass's live observations. `U01–U27` refer to the latest user annotation set, in its displayed order. Earlier chat screenshots supply additional requirements, identified as earlier user evidence. The [browser ledger](browser-evidence.md) distinguishes exercised controls, visible controls and untested workflows. It is an analyst transcription; a raw authenticated REA capture was not exported.

## Source identities and ownership

- Desktop repository: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`.
- Branch: `codex/infrastructure-studio-preview`; source revision at investigation start: `b8c281808ac28f17942b498c7d513cd94df1ed49`.
- Saved implementation checkpoint: `e780e4d3b7a`; [resume guide](../REFINEMENT-CHECKPOINT.md).
- User-owned reference source, read only: `Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web`. Individual hashes are in [source archaeology](source-archaeology.md#source-identities); its serving build identity was not proved.
- Rust service/protocol, read only: `Z:/CloudForge`. The canonical [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:29) controls production authority; none of these reports edits it.
- Integration owner: the CloudForge desktop UI task in this chat. A future cross-repository implementation must explicitly coordinate desktop and Rust revisions through that owner.

The existing studio remains a standalone preview excluded from extension packaging. Its localhost tab was unavailable in this pass. Previous build/test/browser results remain inherited evidence in the checkpoint, not newly executed results.

At the final read, Rust HEAD was `5d0c076e13b545b1b55814569bb3e22bbefc5e1e` and the protocol file SHA-256 was `13fe8e3fa78981f0cfb0d9c634b3c74543c6a46acc2fbab48d0152e6ecc10212`. This identifies the contract consulted, not a newly packaged/tested service artifact. [Documentation verification](verification.json) records 118 checked local links, 88 cited line bounds, five matching source hashes and complete U01–U27 mapping. Line-bound validation does not independently prove every claim's semantics.

## Investigation limits and exact continuation

Live exploration covered Brainboard's selected subnet form and shape drawer, and Miro's connector controls, shape catalogue, pack management, comments entry, nested diagram editing and resizing. Browser transport later closed and failed two reconnection attempts. No complete reference settings, project lifecycle, panel-resize sweep, persistent reload, multi-user or source-to-editor round trip was completed in this pass. Storage inspection was unavailable through the scoped CDP capability. No authenticated request/frame bodies were retained.

Next: reconnect the existing tabs; finish the bounded browser scenarios in [roadmap](roadmap.md#remaining-investigation), starting with panel resizing and architecture settings. Separately, the first implementation slice should be a typed domain/selection contract and its adapter, before richer forms or connector semantics. The current request has not authorized execution of that roadmap.
