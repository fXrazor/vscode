# Annotation system report

## Evidence and limits

**Confirmed live (MI-06):** Miro offers a Comment tool, a point-initiated unsent composer with Reply or @mention and Send, plus Updates with board/global scopes. No message was submitted. Existing threads, replies, resolution, author permissions, pins following objects and persistence after reload were not tested.

**Confirmed live (MI-03/08):** canvas objects have DOM editing overlays, resize handles and connection points. These are authoring affordances, not proof that comment markers use the same rendering strategy. The user-supplied numbered browser comment markers are tooling annotations; do not mistake them for Miro/Brainboard application entities.

**Confirmed live (NET-01):** WebSocket frames flowed during the observation window. Their contents were not decoded. A comment storage model, CRDT/OT algorithm, presence transport or durable acknowledgement cannot be derived from frame length.

**Confirmed bounded source:** [CloudLab model](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:30>) supports resource/data/icon/module/shape/text nodes. It has no explicit board-thread, author/resolution or cursor/presence entity in the inspected model. [Preview BoardItem](C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/model.ts:46) supports frame/note/text/shape, not threaded review. CloudLab AI Agent Studio threads have a different purpose and lack a demonstrated canvas anchor contract. See [bounded source search](source-archaeology.md#annotationcollaboration-boundaries).

## Questions and confidence

| Question | Finding |
| --- | --- |
| Rendering strategy | **Unknown** for commercial comment pins. **Strongly Likely:** screen-space readable controls coexist with world-space artwork, because this is directly visible for other Miro overlays. This does not prove comment implementation. |
| Data model | **Unknown** commercially. **Possible:** annotation record + anchor + thread/message records; needed in CloudForge. |
| Persistence | **Unknown** commercially; no comment submitted/reloaded. Preview has no persistence adapter; CloudLab shapes/text save inside Project. |
| Positioning | Blank-point composer observed. Object/edge attachment, deletion behavior, normalized offsets and offscreen markers **Unknown**. |
| Zoom | Scene and toolbar use different layers; pin sizes/cluster behavior across zoom **Unknown**. |
| Synchronization | Bidirectional socket traffic **Confirmed**; message classes, ACK/retry/dedup/conflict policy **Unknown**. |
| Multi-user | **Unknown**: no second user/session, permission or reconnect exercise. |

## Proposed CloudForge annotation architecture

Separate durable review content from Terraform-producing resource configuration. Keep authored notes/shapes as board content; a sticky note and a threaded comment have different semantics. A future document can contain both while the generated infrastructure excludes review messages.

```ts
type AnnotationAnchor =
  | { kind: 'world'; x: number; y: number }
  | { kind: 'entity'; entityId: string; u: number; v: number }
  | { kind: 'edge'; edgeId: string; fraction: number; offset: number }
  | { kind: 'field'; entityId: string; path: string[] };
type ReviewThread = {
  id: string; architectureId: string; anchor: AnnotationAnchor;
  createdBy: string; createdAt: string; revision: string;
  resolvedAt?: string; resolvedBy?: string; orphaned?: boolean;
};
type ReviewMessage = {
  id: string; threadId: string; authorId: string;
  body: string; createdAt: string; editedAt?: string; revision: string;
};
```

These are proposed local concepts, not recovered wire types or approved service methods. IDs/timestamps/authors must come from the authorized service rather than trusting editable client fields. Content needs a defined text/rich-text format, sanitization, size limits and permissions.

| Component | Behaviour and state | Backend integration |
| --- | --- | --- |
| AnnotationLayer | Derive pin location from current renderer's entity geometry; world-point pins remain world anchored. Keep readable pin hit targets independent of canvas zoom. | Reads annotation snapshot at a revision; no copied infrastructure graph. |
| ThreadPopover / ReviewPanel | Selected pin opens thread; keyboard focus returns to anchor on close; panel removable. Filter unresolved/current selection when helpful. | Proposed read/create/reply/edit/resolve operations with expected revision and operation ID. Not present in current Rust contract. |
| AnchorResolver | Resolve entity/field/edge references; display orphaned state when target is removed. Do not silently move a review to an unrelated node. | Stable identity/reconciliation must account for regenerated compact source graph IDs. |
| PresenceLayer | Short-lived cursor/selection/viewing indicators; throttle and expire. Avoid exposing private editor text or absolute workspace paths. | Separate ephemeral channel with scoped authorization, expiry and reconnect semantics. |
| ReviewPermissions | Show actual edit/reply/resolve rights and rejection states. | Server authorizes every operation; project/architecture access must be consistent with existing scope authority. |

Normalize entity anchor coordinates to item-local bounds (`u`,`v`) so resize/renderer changes can resolve a stable relative attachment. Whether a field comment appears on its form, the node, or both is a product decision. An edge anchor needs a chosen path-length/fraction convention so a routing change does not teleport its label arbitrarily. Keep screen pixels out of durable anchor records.

Deletion must be explicit: resolve/remove the thread, retain it as orphaned review, or relocate after user action. Do not discard discussions merely because a visual projection hides a node. Review undo should not roll back another author's posted message; define local edit versus shared history before selecting a collaborative library.

## Acceptance and research gates

1. Create an annotation in a disposable fixture; pan/zoom, resize/reparent, switch renderer/theme and reload. The anchor remains meaningful and body stays readable.
2. Select an annotation by keyboard, close its popover, and recover focus. Pins hidden by collapsed scopes remain discoverable from the review list.
3. Test target deletion/source reparse, stale edits, author revocation, duplicate retries and reconnect with two authorized clients.
4. Confirm network message and persistence semantics using supported captures before choosing CRDT/OT, database or room implementation. Do not infer any of these from Miro's visible socket activity.
5. Keep comments/presence outside Terraform output and infrastructure cost/validation. Confirm export policy for notes, highlights and review pins separately.

Priority: **Medium** after typed graph/schema/source integrity; anchor identity must be designed early because it depends on stable domain IDs.
