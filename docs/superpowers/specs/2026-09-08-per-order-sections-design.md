# Per-order sections: an overlay on `AO_TEMPLATE`

**Date:** 2026-09-08.
**Status:** design, approved for planning.
**Supersedes:** the deferral recorded as item 5 of
`docs/superpowers/specs/2026-09-03-second-bundle-findings.md` section 5,
*"Per-run section list, the big one, deferred deliberately."*

The client's instruction, restated by the operator: extra documents should
become their own sections; the operator adds sections; one document may produce
several; sections like the split BA and the email are not in every contract, so
they must stop being rigid slots and become slots made for that contract. If a
document is read by AI, the AI proposes the sections, and the operator can still
rename every one of them.

The evidence that this is right rather than merely asked for: comparing the two
human-authored Form Validasi documents the project has seen, **only two of
roughly a dozen section headings are common to both.** `AO_TEMPLATE` is not the
template with some sections left empty. It is a transcription of one order's
document set.

---

## 0. The decisions this design is built on

Answered by the operator on 2026-09-08 and not re-litigated below.

| Question | Answer |
| --- | --- |
| What does "do not scan this document with AI" mean? | **Still OCR it.** The page plan, snap-to-lines and line citations keep working. Only the proposing stops. |
| What happens to the 12 built-in sections? | They become a **starting suggestion**. Every one may be renamed, reordered and deleted. |
| Can an operator-created section fill xlsx column E? | **No. Evidence only**, in the docx. Column E stays driven by `template.xlsxRows`. |
| Scope | **The operator UI and `pnpm generate`.** |
| What is inside an operator-created section? | **Always a picture stack.** Never a table. |
| What does "continuation until covered" cover? | **One bagian**, split by a page break. Not a page-range sweeper. |
| How far may the AI decide? | It **proposes** a section list; the operator rules on each one. |
| Does renaming change what the AI searches for? | **No.** A name is for printing. See section 4.5. |
| What is a section called on screen? | **judul.** See section 9.2. |

---

## 1. The spine, and why it is an overlay

`AO_TEMPLATE` stays the compile-time authority. A run stores a **diff**, and one
pure resolver turns base plus diff into an ordinary `Template`.

The reason is mechanical rather than aesthetic: almost every template-driven
function in the tree **already takes `template: Template` as a parameter**.
`sheetSections` (`src/lib/ui/slots.ts:240`), `unmatchedStates` (`:314`),
`planExport` (`src/lib/ui/export.ts:210`), `renderSection`
(`src/lib/export/docx.ts:159`), `proposeZones`
(`src/app/api/propose/handler.ts:495-505`) and the extract route
(`src/app/api/extract/handler.ts:290`) all do. So the resolver is very nearly
the entire integration surface, and **the constructed docx path the operator
actually uses needs no edits at all**: it prints `section.title` verbatim
(`src/lib/export/docx.ts:163-167`) and groups crops by `slotDef.key`
(`:169-178`).

### 1.1 The prompt half becomes its own object, and it is a rename

This lands before anything else exists (S2 in section 11), and it is the single
most important change in the design.

`src/lib/forms/template.ts:3-92` declares `SlotDef` with `label` and `hint` as
sibling strings. Four prompt builders compose questions out of them:
`src/app/api/propose/handler.ts:642-645` (`SlotQuestion`), `:369-370`
(`findContinuations`), `scripts/generate.mjs:1288-1291` (`slotSearchLabel`), and
`scripts/measure-locate.mjs` (its `askedAs`, around `:1355-1362`). A rename that
writes `label` therefore silently rewrites two live prompts and the gate
harness's own question, which is the one change AGENTS.md forbids without three
fresh samples.

So the fields separate by type:

```ts
// src/lib/forms/template.ts

/**
 * THE HALF A PROMPT SEES. Frozen at transcription time, never editable by an
 * operator, never carried on the wire as anything else.
 *
 * `label` is duplicated from `SlotDef.label` on purpose: the display name is
 * now free to change per order, and the question must not follow it. The
 * duplication is a couple of dozen lines in this file, and it is what turns
 * "a rename cannot move the gate" from a rule someone remembers into a
 * compiler error.
 */
export type SlotAsk = { label: string; hint: string };

export type SlotDef = {
  key: string;
  /** What the OPERATOR and the DOCX see. Overlay-editable. */
  label: string;
  /** A ranking preference for `rankedPoolForSlot`. NOT overlay-editable. */
  docType: DocType | null;
  /** The question. NOT overlay-editable, on no screen, on no wire. */
  ask: SlotAsk;
  catatan?: { adalah: string; bukan?: string };
  fillable: boolean;
  /**
   * WHICH PAGE OF ITS DOCUMENT TYPE THIS WHOLE-PAGE SLOT TAKES, 0-based,
   * declared rather than counted. `wholePageProposals` derives it today with a
   * running counter over the section's fillable slots
   * (`src/app/api/propose/handler.ts:209-215`), which means deleting `sp.1` for
   * this order slides `sp.2` onto the first SP page, and restoring `sp.1`
   * slides it back while `sp.2` still holds a confirmed crop of that same
   * page: two headings, one picture, twice. Declared here it survives both.
   * Required for a fillable slot in a `layout: "images"` section, absent
   * otherwise.
   */
  pageOrdinal?: number;
  /**
   * Present ONLY on a slot this order added. `AO_TEMPLATE` never sets it.
   * It is the whole "this is never searched" predicate. See `isSearchable`.
   */
  added?: { id: NodeId; origin: "human" | "llm" };
};

export type SectionDef = {
  /**
   * Stable identity, hand-written beside `title` in the same transcription
   * pass. NEVER derived from the title: a title is a transcription that has
   * been corrected before, and an id derived from it forks every stored run
   * the moment it is.
   */
  id: string;
  title: string;
  layout: "images" | "table";
  slots: SlotDef[];
  /** The section half of `generate.mjs`'s composed question. Frozen. */
  ask: { title: string };
  added?: { id: NodeId; origin: "human" | "llm"; fromSourceId?: string };
};
```

`SlotQuestion` (`src/lib/pipeline/locate.ts:640-644`) becomes
`{ key: string; ask: SlotAsk }`, and `findContinuations`
(`src/lib/pipeline/continuation.ts:779-790`) takes `ask: SlotAsk` in place of
its `slotLabel: string; hint: string` pair. **Passing a display string where a
prompt is expected stops type-checking.** That is the fence, and it is why this
is a rename rather than an added optional field.

### 1.2 The overlay, `src/lib/forms/overlay.ts`

A pure leaf with no imports from `browser/` or `storage/`, for the reason
`src/lib/browser/slot-key.ts:1-15` gives about itself: both sides of the wire
need it, and `runtime.ts` carries `"use client"`.

```ts
export const OVERLAY_VERSION = 1;

/** Base nodes use their declared id; added nodes use `u:<uuid>`. Never "#". */
export type NodeId = string;

export type SectionPatch = { title?: string; removed?: true };
export type SlotPatch = {
  label?: string;
  catatan?: { adalah: string; bukan?: string };
  removed?: true;
};

/** A bagian inside an added judul. Always part of a picture stack. */
export type AddedSlot = { id: NodeId; label: string };

export type AddedSection = {
  id: NodeId;
  title: string;
  slots: AddedSlot[];
  origin: "human" | "llm";
  fromSourceId?: string;
  /** Where the title was read off, so the operator can check the quotation. */
  cite?: { pageIndex: number; lineRange: [number, number] };
  /**
   * Run-global page positions this judul's evidence was seeded from, kept so
   * `scripts/generate.mjs` can fill an added judul deterministically with no
   * model call. Dropped by `removeSource`, which renumbers `run.pages`.
   */
  pages?: number[];
  /**
   * There is NO `layout` field and there must never be one. The resolver emits
   * `layout: "images"` for every added judul. A field invites a table, and a
   * table slot is the one thing that costs a locate call and the one thing
   * that can return a plausible fragment of the right page
   * (`src/app/api/propose/handler.ts:176-190`).
   */
};

/**
 * A judul the discovery stage proposed and NOBODY HAS RULED ON.
 *
 * A SEPARATE LIST WITH A SEPARATE TYPE, not an `accepted: false` flag on
 * `AddedSection`, and that is the difference between "the exporter must
 * remember to filter" and "the exporter cannot see it". `resolveTemplate` does
 * not read this field at all, so an AI-invented heading cannot reach
 * `renderSection` (`src/lib/export/docx.ts:159-177`, which emits a heading for
 * an empty images section unconditionally and deliberately), cannot reach
 * `planExport`, and cannot reach `buildPatches`. Accepting one MOVES it into
 * `added` with fresh ids; rejecting one deletes it.
 */
export type ProposedSection = {
  id: NodeId;
  title: string;
  fromSourceId: string;
  /** Run-global page positions, ascending and contiguous. */
  fromPages: number[];
  cite: { pageIndex: number; lineRange: [number, number] };
};

export type TemplateOverlay = {
  version: typeof OVERLAY_VERSION;
  /** `AO_TEMPLATE.id`, checked on resolve. */
  base: string;
  /** Base section ids plus slot keys, hashed at creation. See section 10.1. */
  baseFingerprint: string;
  sections: Record<NodeId, SectionPatch>;
  slots: Record<NodeId, SlotPatch>;
  added: AddedSection[];
  proposed: ProposedSection[];
  /** Full judul order, base and added mixed. Absent: base order, then added. */
  order?: NodeId[];
};
```

**There is deliberately no slot-order field, and bagian cannot be moved between
judul.** `pageOrdinal` is a fact about which page of its document type a
whole-page bagian takes; a reorder that moved it would silently reassign pages
under confirmed crops, and a move into a foreign judul would hand it a page of a
different document type.

### 1.3 What `BrowserRun` and `RunSource` gain

```ts
// src/lib/browser/types.ts
export type BrowserRun = {
  // ... unchanged ...
  /** This order's diff against AO_TEMPLATE. Required; empty for a fresh run. */
  overlay: TemplateOverlay;
};

export type RunSource = {
  // ... unchanged ...
  /**
   * MAY THE AI PROPOSE ANYTHING FROM THIS BERKAS. Absent means yes, which is
   * what every run stored before this field existed meant.
   *
   * It does NOT mean "was it read". Every berkas is OCR'd either way; this
   * gates proposing, ranking, continuation walking and extraction, never
   * recognition. See section 6.
   */
  ai?: boolean;
  /**
   * Source ids discovery has already been asked about, so pressing Proses
   * twice does not pay for the same answer twice.
   */
  sectionsAskedFor?: boolean;
};
```

`SlotState` gains **nothing**. That is load-bearing: it is what keeps
`removeSource`'s three-field whitelist (`src/lib/browser/sources.ts:198-209`)
correct, and what keeps `persistence.test.mts:659-677` valid.

---

## 2. Slot identity under rename

**The rule: `SlotState.key` is an identity, never a name. A rename writes
`overlay.sections[id].title` or `overlay.slots[id].label` and touches no
`SlotState` at all.**

- A base bagian's id is its existing `SlotDef.key` (`"kb.nomor"`). A base
  judul's id is its new hand-written `SectionDef.id`.
- An added node's id is `u:${crypto.randomUUID()}`.
- A capture of an added bagian is `u:9f3e...#2`. `slotKeyOf`,
  `captureOrdinalOf`, `captureKeyFor` and `nextCaptureOrdinal`
  (`src/lib/browser/slot-key.ts:31-97`) all work on it unchanged:
  `captureOrdinalOf` finds no `#` on capture 1 and returns 1, and the
  high-water rule reads ordinals off the surviving keys as before.
- `assertNodeId` rejects any id containing `#`, at the boundary, in both the
  UI and `assertOverlay`. A judul titled `Pasal #3` is fine; an *id* carrying a
  `#` would group under a slot it does not belong to.

**Proof that a rename cannot be read as a deleted crop.** `CaptureLossError`
fires inside `putRun`'s own transaction at `src/lib/storage/runs.ts:543-548`:

```ts
const carried = new Map(run.slots.map((slot) => [slot.key, slot]));
const dropped = (stored.slots ?? [])
  .filter((slot) => slot.zone && !carried.get(slot.key)?.zone)
```

Its entire input is `slot.key` and `slot.zone`. A rename write is
`{ ...run, overlay: next }`; `run.slots` passes through by reference, `carried`
is key-for-key and zone-for-zone identical to `stored.slots`, `dropped` is
empty, and the branch cannot throw. No `removing` opt-in is needed or offered.
The same holds for a reorder and for hiding a judul, both of which are patches
rather than state writes.

The stronger statement, which is the one that survives a future writer: even a
caller that *also* copies the new label onto every matching `SlotState` trips
nothing, because the guard compares keys and zones and a label copy changes
neither.

**A deletion is visible, and that is deliberate.** Dropping a judul whose bagian
carry zones would leave those states behind as orphans (`unmatchedStates`,
`src/lib/ui/slots.ts:314-323`). So a delete is not allowed to be a quiet
reclassification: it drops the states in the same write, naming the
zone-carrying ones in `removing` and the node ids in `removingSections`
(sections 3 and 8.2). That is why deletion is the one edit that asks.

---

## 3. The new loss guard, and the storage hole closed with it

### 3.1 The premise that inverts

`src/lib/storage/runs.ts:154-157` justifies `CaptureLossError` ignoring
zone-less states: *"A capture nobody has found evidence for costs nothing to
re-seed."* True while every bagian came from a compile-time constant. It stays
true for `SlotState` under this design, because nothing an operator authors
lives there, and `persistence.test.mts:659-677` stays correct and green.

What inverts is one level up. **`run.overlay` is the only place an operator's
naming work exists.** A rebuild from `AO_TEMPLATE.sections` emits
`overlay: emptyOverlay(...)` as readily as it emits zone-less captures, arrives
at the correct revision with every page and every capture key present, reverts
every heading, deletes every added judul, and reports success. That is exactly
the writer `CaptureLossError` was built for, one level up.

### 3.2 `SectionLossError`

```ts
/**
 * A write that would silently drop work the OPERATOR authored: a judul or
 * bagian they named, or a judul they added.
 *
 * THE FOURTH NET, AND IT GUARDS `overlay` FOR THE REASON `CaptureLossError`
 * GUARDS `slots`. The writer both nets were built for is the same one.
 *
 * AUTHORSHIP, NOT PRESENCE. A `ProposedSection` may be dropped freely: it is a
 * usulan nobody has ruled on, which is the same line `CaptureLossError` draws
 * between a zone-carrying state and an empty one, drawn one level up. Adding a
 * `removed: true` patch is the operator deleting: a write, not a loss.
 * Reordering loses nothing.
 */
export class SectionLossError extends Error {
  readonly runId: string;
  /** Overlay node ids whose authorship this write discards. */
  readonly missing: NodeId[];
}
```

It refuses, relative to the stored overlay: an `AddedSection` that disappears
from `added`; a `SectionPatch.title`, a `SlotPatch.label` or a
`SlotPatch.catatan` that is dropped or reverted; and the overlay going from
non-empty to empty. Unless every affected id is named in:

```ts
// src/lib/storage/runs.ts:453-498, beside `removing` and `removingPages`
  /**
   * Overlay node ids whose stored NAME or EXISTENCE this write deliberately
   * discards. A list of ids, never a boolean, for the reason `removingPages`
   * states at :470-497: a caller naming ids is saying "I know about exactly
   * these", so a write that ALSO loses one it never knew about still fails.
   */
  removingSections?: readonly NodeId[];
```

**Two opt-ins, not one.** `removing` is about a potongan and `removingSections`
is about a name. Folding them would let a caller discard a crop while meaning to
discard a heading.

### 3.3 Where it sits

Inside `putRun`'s single readwrite transaction
(`src/lib/storage/runs.ts:500-579`), in this order:

1. duplicate page ids (`:504-510`), unchanged;
2. `StaleRunWriteError` (`:522-526`), unchanged, still first, because every
   other refusal a stale write earns is a consequence of its staleness;
3. **`SectionLossError`**, new;
4. `CaptureLossError` (`:531-548`), unchanged;
5. `PageLossError` (`:551-560`), unchanged.

Third rather than fourth because the rebuild-from-template writer trips both 3
and 4, only one error can be thrown, and the overlay is the root cause while the
captures are the larger, louder consequence. It is also the cheapest check.

A stored record with no overlay (pre-migration) is treated as empty and can lose
nothing.

### 3.4 `appendPage` narrowed, write and return together

`appendPage` (`src/lib/storage/runs.ts:607-634`) carries the revision check only
and then writes `runs.put({ ...run, rev: next })` at `:630`, which is the
caller's whole `RunMeta`, including `slots` and now `overlay`. Both lines
change:

```ts
    runs.put({ ...stored, sources: run.sources, rev: next } satisfies RunMeta);
  });
  return { ...stored, sources: run.sources, rev: next };
```

`sources` is the one part of the small half an ingest legitimately changes
(`withAppendedPage`, `src/lib/browser/runtime.ts:229-243`, updates `pageCount`).

**The return must change with the write.** Leaving `return { ...run, rev: next }`
(`:633`) hands the caller its own pre-ingest `slots` and `overlay` stamped with
the advanced revision, which then passes all four guards on the next ordinary
save and writes the stale arrays back. That is the loss this change exists to
close, moved one function outward.

`ingestDocument` (`src/lib/browser/runtime.ts:600-625`) keeps the returned meta
as `lastWritten` and finishes `return { ...run, ...(lastWritten ?? metaOf(run)) }`.
`RunMeta = Omit<BrowserRun, "pages">` (`src/lib/storage/runs.ts:52`), so
`run.pages` survives the spread.

**Honest scope.** `ingestDocument` holds `withRunLock` for the whole ingest
(`src/lib/browser/runtime.ts:489`) and every append advances the revision, so a
same-tab edit cannot land mid-ingest and a cross-tab one makes the next append
throw `StaleRunWriteError`. This is defence in depth that makes a clobber
structurally impossible, not a live loss path being closed. It is worth landing
anyway, and it lands first (S1) precisely because it is separable from the
feature.

### 3.5 The edit path never holds a stale run

Because the ingest holds the run lock for minutes, a section edit built against
a React-held run and saved afterwards would be many revisions stale and refused.
Rather than retrying, **section edits are never expressed against an in-memory
run at all.**

`src/lib/browser/sections.ts` exports one pure function:

```ts
export type SectionEdit =
  | { tag: "rename-section"; id: NodeId; title: string }
  | { tag: "rename-slot"; id: NodeId; label: string }
  | { tag: "move-section"; id: NodeId; by: -1 | 1 }
  | { tag: "remove-section"; id: NodeId }
  | { tag: "restore-section"; id: NodeId }
  | { tag: "add-section"; title: string }
  | { tag: "record-proposals"; sourceId: string; sections: ProposedSection[] }
  | { tag: "accept-proposal"; id: NodeId }
  | { tag: "reject-proposal"; id: NodeId };

export function applySectionEdit(
  run: BrowserRun,
  edit: SectionEdit,
): { run: BrowserRun; removing: string[]; removingSections: NodeId[] };
```

and `src/lib/browser/runtime.ts` gains `editSections(runId, edit)`, which takes
the run lock, reads the **stored** run, applies the edit to that, and writes with
the options the helper computed. It returns the stored run, and the caller must
keep it (`src/lib/storage/runs.ts:445-447`). The UI contract mirror
`src/lib/ui/runtime.ts` re-exports it, so `wiring.test.mts` holds the two
together function by function.

This is the shape `removeSource` already has
(`src/lib/browser/sources.ts:92-241`), and it makes a rename during a 151-page
ingest a queued write against the current record rather than a refused one
against a stale copy.

---

## 4. The wire

### 4.1 `ProposeBody` and `ProposeResult`

```ts
// src/app/api/propose/handler.ts:66-101
export type ProposeBody = {
  runId: string;
  pages: WirePage[];
  wanted: string[];
  captures?: { key: string; zone: Zone }[];
  /** This order's diff. Absent means the base form exactly. */
  overlay?: TemplateOverlay;
  /** Source ids to propose a judul list for. Absent or empty: no call. */
  discover?: string[];
};

export type ProposeResult = {
  proposals: Proposal[];
  /** Searched and not found. Drives the dokumen tambahan loop. */
  outstanding: { key: string; reason: string }[];
  continuations: ContinuationAnswer[];
  /**
   * Wanted keys this route DID NOT SEARCH, and why. NEVER "not found".
   * `applyProposals` leaves these slots' status exactly as it found them.
   */
  outOfScope: { key: string; reason: string }[];
  /** Source ids excluded by the operator, echoed so the UI can say so. */
  excludedSources: string[];
  /** One entry per source in `discover`. See section 5. */
  sections: DiscoveredSections[];
};
```

`WirePage` (`src/lib/api/wire.ts:51-59`) gains `searchable?: boolean`, absent
meaning true.

### 4.2 How the route stops imposing its compiled-in template

`proposeZones` already takes a template with a default
(`src/app/api/propose/handler.ts:495-505`). One line changes:

```ts
  template: Template = resolveTemplate(AO_TEMPLATE, body.overlay ?? emptyOverlay(AO_TEMPLATE)),
```

A default parameter may reference an earlier one, so there is no restructure, and
every test that passes a template explicitly keeps working. `route.ts:113`
(`proposeZones(body, ask)`) does not change.

`parseProposeBody` (`:786-805`) gains `assertOverlay(body.overlay)` beside the
existing `assertWirePages` and `assertCaptures`, for the reason `assertCaptures`
states at `:826-833`: shape-check before a single token is spent, and answer 400
rather than letting a caller's mistake arrive as a TypeError on the
provider-failure path. It checks the version, the base id, well-formed unique
`#`-free node ids, titles non-empty and under 200 characters, `added[].slots` an
array, `order` duplicate-free, and **that a page marked `searchable: false`
carries zero lines**, so the flag and the payload can never disagree.

### 4.3 Three ways a wanted key can avoid the search, none of which lies

`outOfScope` takes:

- a key whose resolved def carries `added`, with reason *"this bagian belongs to
  a section the operator added; its evidence is taken by hand or from an
  accepted page proposal, and it is never searched for"*;
- a key with no resolved def at all, which today is pushed to `outstanding` at
  `src/app/api/propose/handler.ts:594-597` with `"no slot with this key in the
  template"`. It moves to `outOfScope` unchanged.

That second one is the fix for the deleted-judul lie. `outstanding` renders as
**tidak ditemukan** (`docs/ui-bahasa.md:83`), and telling an operator that a
bagian they deleted was searched and not found is a false statement of exactly
the class `AskFailed` was written for (`:466-478`).

**The route is not the only net.** `wantedKeys` (`src/lib/ui/propose.ts:86-100`)
and `capturesToWalk` (`:120-128`) both take the resolved template and filter on
`isSearchable`, so in practice `outOfScope` is empty. It exists because the route
must not depend on the client having read this paragraph. `buildProposeRequest`
(`:142-155`) takes the template too.

`applyProposals` (`:174-222`) is given `outOfScope` and leaves those keys alone.
It reads only `proposals` and `outstanding` today, and its parameter is already
narrowed to `Pick<ProposeResponse, "proposals" | "outstanding">` for a documented
reason; it becomes a three-way `Pick` and ignores the third, which is the point.

### 4.4 The whole-page router, fixed at the branch that actually runs

`proposeZones` builds `imageSections` from every wanted key whose resolved
section is `layout: "images"` (`src/app/api/propose/handler.ts:555-572`) and runs
`wholePageProposals` over them **before** the `byPool` loop, whose
`if (entry?.section.layout === "images") continue;` sits at `:589`.

So a bail-out added in the `byPool` loop is unreachable for an images section,
and an added judul (layout images, `docType: null`) would land in
`wholePageProposals`' `!page` branch (`:224-235`) and be pushed **outstanding**
with `"whole-page slot with no document type to identify its page"`. Forever, on
every Proses, on the feature's own main path.

Three changes close it:

1. `imageSections` skips any section carrying `added`, and every one of its
   wanted keys goes to `outOfScope`;
2. `wholePageProposals` reads `slot.pageOrdinal` instead of its running
   `seenOfType` counter (`:209-215`), so deleting and restoring a base
   whole-page bagian cannot slide another one onto a different page;
3. the client filter in 4.3 means such a key normally never arrives.

`scripts/generate.mjs:1701-1743` carries its own copy of this router and gets
change 1 in the same diff, reporting added judul under a new `manual` list rather
than in `reasons` (section 10.3). It **keeps** its own round-scoped `taken`
counter (`:1739-1741`) rather than adopting `pageOrdinal`: that counter
deliberately means "the first SP page this tambahan round supplied", which is a
different and correct question for a headless multi-round run, and the comment
there says so.

### 4.5 What this costs at the measurement gate

**A rename cannot move any prompt, and it is a compiler-checked property rather
than a claim.** Every prompt builder now takes `SlotAsk` or `SectionDef.ask`,
both of which the overlay has no field for and no screen can reach. The check is
three unit tests, not a gate run:

```
questionsFor(resolveTemplate(AO_TEMPLATE, renameEverything))
  deep-equals questionsFor(AO_TEMPLATE)
findContinuations' ask argument, same
slotSearchLabel over the resolved template, byte-identical per slot
```

That is a stronger guarantee than three samples could give, because
`scripts/measure-locate.mjs` does not go through the route at all: it calls the
Gemini REST surface with plain `fetch` and reads its own env defaults, so a gate
run cannot see a wire bug.

**A deletion changes which calls are made, not what any surviving call says.**
`MAX_SLOTS_PER_LOCATE_CALL` ships at 1 (`src/app/api/propose/handler.ts:423-428`),
so one slot is one prompt and removing a slot removes a call without changing a
surviving prompt's bytes. **If that dial is ever raised, a deletion reshapes a
multi-slot prompt and the equality tests above must be extended to cover pools.**
Write that sentence into `src/lib/pipeline/locate.ts`'s header beside the dial.

**The gate is still re-run once, three samples, at S2**, because the `hint` to
`ask.hint` rename touches every prompt builder and "the strings did not change"
is a claim that gets paid for rather than asserted. The acceptance criterion is
the **set of passing slot names across three runs**, never a total: three runs of
the identical prompt already scored 11, 9 and 11, with `KB / Nomor` and
`KB / Detail` each failing in one. Page selection stays the stable signal at
12/12. The current column in AGENTS.md is replaced, never added to.

`scripts/measure-locate.mjs` needs exactly the mechanical rename at its `askedAs`
and reads no overlay, ever: the twelve human crops are the yardstick, and letting
a per-order edit move them would move the ruler and the thing measured at once.
Its ground-truth guard at `:1344-1356` still fires, because `AO_TEMPLATE` is
unchanged.

---

## 5. AI section discovery

### 5.1 Where it runs

A phase inside `/api/propose`, gated on `body.discover`, not a new route.
`src/app/api/propose/route.ts` is 151 lines of auth gate, per-call cost log,
`unreachable` (`:130`) and `maxDuration = 300` (`:40`), all of which a second
route would copy, and `propose.test.mts` already drives the handler with no Next
runtime. A second route is a second gate to get wrong.

The pipeline half is a new pure module `src/lib/pipeline/sections.ts`, built like
`src/lib/pipeline/classify.ts`: a zod `Reply`, `extractJson` from
`src/lib/pipeline/json.ts`, validation after parse, an injected
`Ask = (prompt: string) => Promise<string>` and **no image parameter**, so
"classify, locate and extract are provably text-only" extends to it unchanged.

### 5.2 Input

One source document at a time, its pages renumbered locally from 0 and mapped
back to `pages[i].index` afterwards. That renumbering is not style: a pool
starting at page 23 made the model answer 22, hidden for weeks because every
other pool started at 0.

Content is `classifyPages`' exact diet: the first `HEAD_CHARS` (400) of each
page's OCR text (`src/lib/pipeline/classify.ts:22-29`), reused rather than
re-invented, because that is the one prompt shape here measured at a
page-count-scaling cost that stays small.

### 5.3 The question and the schema

The question leads and the listing follows, which is the ordering the
prefix-cache experiment concluded on.

> These are the opening lines of each page of one scanned document, in order. A
> validation packet reproduces this document as sections, each section being a
> run of consecutive pages a human would screenshot together under one heading.
> List those sections. The title must be the document's own heading,
> transcribed, not a description you write. Pages belonging to no such section:
> leave them out. Reply with JSON only.

```ts
const Reply = z.object({
  sections: z.array(z.object({
    title: z.string().min(1).max(80),
    fromPage: z.number().int().min(0),
    toPage: z.number().int().min(0),
    /** The lines on `fromPage` the title was read off. */
    titleLines: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  })).max(20),
});
```

There is **no `layout` field**. The model is never offered "table". The decision
that operator-created sections are picture stacks and the cheapest failure mode
agree.

### 5.4 Validation, checked and never trusted

- `fromPage <= toPage <= last`, as `src/lib/pipeline/classify.ts:58-65` does;
- **no two spans overlap.** A page that is evidence under two headings is a
  duplicate crop, which is the exporter hazard `groupByKey` exists for
  (`src/lib/export/docx.ts:142-157`);
- **gaps are legal, and this is the deliberate departure from
  `classify.ts:67-91`,** which rejects any reply not covering every page exactly
  once. Its stated justification is that nothing downstream confirms its spans;
  here the operator confirms every one, so a reply covering three of 27 pages is
  a normal reply and the head of the sheet says how many pages landed in no
  proposal;
- `titleLines` must name lines page `fromPage` actually has, in order. This is
  `fields.ts`' citation validation, same argument;
- **the title, case-folded and whitespace-collapsed, must be a substring of those
  lines' text.** An invented heading is a fabricated section title in a document
  a validator signs, and this is also what keeps the mono "quoting the document"
  rule true through the AI stage (section 9.6);
- **a span whose `fromPage` has zero OCR lines is dropped.** `wholePageZone`
  writes `lineRange: [0, Math.max(0, last)]`
  (`src/app/api/propose/handler.ts:158-171`), so a page with no lines cites
  `[0, 0]`, a line that does not exist. That is latent today because every ingest
  OCRs and a page that read short is kept loudly with a `PageShortfall`; this is
  the one new path that could seed such a capture, so it refuses instead.

A failing entry goes to `unusable[]` with its reason. **If everything fails, the
answer is an empty proposal list and a sentence, not a fallback.** Inventing "one
judul named after the berkas" is fabrication with better manners; the operator
can press "Tambah judul".

### 5.5 How the output enters the run

`editSections(runId, { tag: "record-proposals", sourceId, sections })` writes them
to `overlay.proposed` and sets `sectionsAskedFor` on the source. They are
rendered as usulan at the head of Periksa (section 9.5) and ruled on one at a
time. `accept-proposal` moves the entry into `added` with fresh ids, one
`AddedSlot` per page of its span, and seeds each bagian's `SlotState` as
`proposed` with the whole-page zone for that page. `reject-proposal` deletes it.

### 5.6 What it costs

Derived from the measured classify line, not measured. 400 characters is roughly
110 tokens, plus about 150 of preamble.

| bundle | in | out | at $1.50 / $9.00 |
| --- | --- | --- | --- |
| sample, 29 pages, 2 berkas | ~3.4k | ~300 | ~$0.008 per berkas, ~$0.016 per order |
| second bundle, 151 pages, 1 berkas | ~16.7k | ~600 | ~$0.03, once |

About 2.5% of the shipped $0.6274 run, paid once per berkas per order because
`sectionsAskedFor` gates it. **These are estimates and AGENTS.md's own rule
applies: run `pnpm generate` and read its printed per-stage table rather than
trusting this one.** The stage gets its own row in `src/lib/cost.ts` so the table
can answer instead, and the flat `cost:` guard keeps the two accountings honest.

### 5.7 No gate row, and what stands in for it

Discovery ships with **no gate number**, said plainly. Three runs of an identical
locate prompt scored 11, 9 and 11, so a one-run total for a new stage would be a
measurement error dressed as evidence. What it has instead: every judul and every
potongan is accepted individually by a person, and `pnpm probe:sections`,
modelled on `scripts/probe-completeness.mjs`, runs discovery over a whole bundle
and prints every span with its page range and its cited title lines for a human
to read.

---

## 6. Per-berkas AI opt-out

### 6.1 What reads the flag

The operator chose "still OCR, the AI just does not propose", so **the ingest
loop does not change at all**: `src/lib/browser/ingest.ts:320` stays
unconditional, the worker protocol gains nothing, and `ingestDocument`'s
signature (`src/lib/browser/runtime.ts:473-478`) gains nothing. The choice is
recorded on the source and read at proposal time in exactly four places:

- **`buildProposeRequest`** (`src/lib/ui/propose.ts:142-155`) sends every page,
  in order, with `index: position` so `assertRunGlobalIndexes`
  (`src/lib/api/wire.ts:69-79`) keeps holding, setting
  `searchable: source.ai !== false` and `lines: []` on an excluded page. The
  lines are withheld at the boundary rather than only downstream, because the
  sentence on screen says the AI does not look inside that berkas, and that
  should be true where the request is built.
- **`proposeZones`** computes
  `const searchable = body.pages.filter((p) => p.searchable !== false)`
  **after** `assertRunGlobalIndexes(body.pages)` has run over the full array, and
  uses `searchable` for `classifyByDocType`, for `rankedPoolForSlot`, for the
  whole-page candidate lists and for `walkContinuations`' per-source grouping.
  **It filters on the flag and never on `lines.length`**, so an empty page and an
  excluded page can never be confused. Coverage is safe: `classifyByDocType`
  groups by `sourceId` and renumbers locally (`src/lib/api/wire.ts:250-263`), and
  exclusion drops whole sources, so `classifyPages`' every-page-exactly-once
  array (`src/lib/pipeline/classify.ts:72-90`) stays dense.
- **`buildExtractRequest`** (`src/lib/ui/extract.ts:90-107`) does the same, and
  `src/app/api/extract/handler.ts` filters its pool by `searchable` before
  hunting a fieldKey. **This is not optional and it is not covered by the
  evidence-only decision.** `src/lib/ui/extract.ts:97` currently sends
  `run.pages.map(...)`, every page, unconditionally. Without the filter a berkas
  the operator fenced off still fills xlsx column E and the docx header table
  with a value carrying a citation that passes validation and points into the
  document they were told would not be checked.
- **`capturesToWalk`** drops captures sitting on an excluded page, which also
  avoids `checkForContinuation` throwing `"zone page X is not among the pages of
  the document supplied"` (`src/lib/pipeline/continuation.ts:401-408`).

On a run with nothing excluded, every prompt and every pool is byte-identical to
today's. A test pins that.

### 6.2 The new word, and the words it must not steal

The blank must not read **tidak ditemukan** (searched, no evidence found,
`docs/ui-bahasa.md:83`).

**No new `Reason` is derived for a bagian from an excluded berkas, and no
existing one is relabelled.** Deriving one for every blank in the run whenever
any berkas is excluded would collapse the four distinct reasons `reasonOf` was
built to keep apart (`src/components/operator/outstanding-panel.tsx:141-179`),
including the operator's own recorded rejection, and would point the tambahan
loop at the wrong berkas. A bagian in an order with an excluded berkas is still
honestly **belum dicari** or **tidak ditemukan**. What changes is that the panel
says, once, at its head, that a berkas was left out:

> **"1 berkas Anda tandai tanpa AI, jadi tidak ada usulan yang datang dari
> halamannya: {nama berkas}."**

The new glossary word attaches to the **berkas**, never to a bagian:

| concept | Bahasa | note |
| --- | --- | --- |
| a berkas the AI may read | **dibaca AI** | the default for every berkas handed over |
| a berkas the operator kept the AI out of | **tanpa AI** | never "gagal", never "dilewati", never "tidak ditemukan" |

Sentence on the berkas row:
**"Halaman berkas ini tetap terbaca dan bisa Anda potong sendiri, tapi AI tidak
mencari apa pun di dalamnya."** That is operator-actionable, because it says what
they can still do, rather than an explanation of where anything runs, so it
survives the rule at `docs/ui-bahasa.md:111-133`.

**A second new reason is needed and is exact.** An added judul's bagian with no
area yet is not "belum dicari": nothing will ever search it. It gets a fifth
`Reason`:

| code | word | mark shape | sentence |
| --- | --- | --- | --- |
| `undrawn` | **belum digambar** | `pending` | "Judul ini Anda buat sendiri, jadi potongannya Anda ambil sendiri." |

Its derivation is per bagian and exact (`isSearchable(template, key) === false`),
never a run-wide relabel.

---

## 7. The editor loop

### 7.1 What exists and is not rebuilt

`takeWholePage` (`src/components/operator/zone-editor.tsx:829-844`) with its
deliberate `snap: false`, and its key at `:1586-1592` ("Satu halaman",
`aria-label="Ambil tangkapan satu halaman"`). The editor stays single-page by
construction: `pickPage` clears the draft on every page change (`:682-690`) and
`save` emits exactly one `Zone` (`:941-955`).

### 7.2 The loop, and why it is not a modal

After a save, the editor shows an inline continuation strip (solid, in flow,
inside the editor, no `backdrop-filter`), with the next page's denah and **two**
keys:

- **"Ambil halaman berikutnya"**
- **"Tidak ada lanjutan"**

There is no third "Nanti saja" key. Closing the editor is later, and it stamps
nothing. A three-key modal that appears after every save trains dismissal, and
its middle key would write a permanent **diperiksa, tidak ada lanjutan** into the
record, which `docs/ui-bahasa.md:54` reserves for a search that actually looked
past that potongan's page bottom.

**The question is asked after every save where a next page exists in the same
berkas, whatever the section's layout.** Gating it to `layout: "images"` would
skip `kbLanjutan.top`, which is a table slot, is the sample's only genuine
continuation, and is the standing gate miss. The next page is `run.pages[i + 1]`
where `i` is the saved zone's `pageIndex`, and only if it carries the same
`sourceId`, which is the fence `checkForContinuation` enforces
(`src/lib/pipeline/continuation.ts:380-408`). If there is none, the strip reads
**"Halaman terakhir di berkas ini."** and only "Tidak ada lanjutan" is offered.

### 7.3 The free hint, and where it must stay silent

`checkForContinuation` is pure and needs only `OcrPage[]` plus `runningFurniture`
(`src/lib/pipeline/continuation.ts:239-276`), both derivable client-side from
`StoredPage.lines`. So for a **drawn region** the strip can carry the geometry's
own reading at no model cost and no network.

For a **whole-page capture it says nothing at all**, because stage 0 returns
`verdict: "whole-page-capture"` with `looksLikeContinuation: false` and the
reason that a whole-page capture ends at its page's last content line by
construction (`:410-421`); three of bundle one's six measured false positives
were exactly that. Dressing a no-information verdict as a recommendation would be
a new wrong-and-quiet surface built by the feature meant to close one.

### 7.4 Which function mints the ordinal key

**`withDiscoveredCaptures` (`src/lib/browser/captures.ts:115-181`), and it stays
the only minter.** "Ambil halaman berikutnya" reopens the editor on the next page
with a whole-page draft armed; on save the append routes through:

```ts
withDiscoveredCaptures(
  run,
  [{ after: previousKey, zone, text, origin: "human", status: "confirmed" }],
  [previousKey],
);
```

which reuses, in one call, four things that would each be a bug if
re-implemented: `nextCaptureOrdinal`'s high-water mark
(`src/lib/browser/slot-key.ts:85-97`), the `zoneFingerprint` de-duplication
(`src/lib/browser/captures.ts:156-158`), the parent-still-has-a-zone check
(`:147`) and the `unfilled` refusal (`:153`).

The one addition it needs: `DiscoveredCapture` (`:37-52`) gains
`status?: "proposed" | "confirmed"`, defaulting to `"proposed"` at `:167`. A
hand-drawn link is `confirmed` because a person drew it and is looking at it. The
comment at `:93-99` explaining why a *discovered* capture is never confirmed
stays exactly as it is and gains one sentence saying this parameter is for the
hand-drawn case only.

`ZoneTarget` gains `after?: string`, and `saveZone`
(`src/components/operator/operator-app.tsx:1227-1251`) routes an append carrying
it through `withDiscoveredCaptures` instead of the raw push at `:1247-1251`.
Capture 1's path is untouched.

### 7.5 Stamping, and stopping mid-chain

- **"Ambil halaman berikutnya" then a save** stamps the *previous* link through
  the `checked` argument. Something looked past it and what it found is now in
  the run, which is the second of the two cases `src/lib/browser/types.ts:88-98`
  names. Leaving the middle of a chain unstamped is what made a second Proses
  re-walk it and append byte-identical duplicates
  (`src/lib/ui/propose.ts:106-113`), so this is not optional.
- **"Tidak ada lanjutan"** stamps the *current* link. A person looked and there
  is nothing there.
- **Closing the editor** stamps nothing. `continuationChecked` reads false and
  the sheet says **belum diperiksa lanjutannya**, which is true: nobody looked.

---

## 8. Export

### 8.1 `planExport` and the new blocking kind

`planExport(run, template)` (`src/lib/ui/export.ts:210`) keeps its signature and
is called with the resolved template. `sheetSections`, `progressOf`,
`blockingItems`, `describeOutstanding` and `collectBlanks` all already take a
`Template` parameter and need no edits beyond the call sites (section 9.1).

**One real addition:** `blockingItems` (`src/lib/ui/export.ts:400-441`) gains a
fourth kind.

```ts
export type BlockingItem = {
  kind: "proposed" | "pending" | "lost" | "orphan";
  // ...
};
```

`plan.orphans` (`:349-354`, via `unmatchedStates`, `src/lib/ui/slots.ts:314-323`)
carrying `hasZone: true` becomes blocking. Today orphans are reported in an
advisory slab (`src/components/operator/export-panel.tsx:1348-1364`) beside a
live build button, and `blockingItems` never reads them, so confirmed evidence a
human personally accepted can fail to reach the file over a green key. That is
`lost`'s own argument (`src/lib/ui/export.ts:387-390`) applied to the case
per-order deletion makes routine. The remedy is reachable: the outstanding
panel's `Di luar template ini` rows
(`src/components/operator/outstanding-panel.tsx:221, :330-340`) gain
**"Buang potongan ini"**, which drops the state naming it in `removing`.

A legitimate delete never manufactures an orphan, because it drops the states
itself (8.2). An orphan therefore means a stored run genuinely outliving its slot
list, which is worth stopping an export for.

### 8.2 What a judul deletion writes

`applySectionEdit(run, { tag: "remove-section", id })` returns:

- a run whose overlay carries `removed: true` (base judul) or has the entry gone
  from `added` (added judul), **and** whose `slots` array has dropped every state
  under every bagian of that judul, empty ones included;
- `removing`: every dropped key that carried a zone, which is
  `CaptureLossError`'s designed opt-in and the same call `withoutCapture` already
  makes (`src/lib/browser/captures.ts:201-206`);
- `removingSections`: the node ids, for an added judul or a renamed one.

Restoring a base judul re-seeds only its own bagian as `pending`, exactly as
`seedSlots` does (`src/lib/browser/runtime.ts:185-197`), and names nothing: an
addition is not a loss.

### 8.3 The constructed docx path

**Nothing changes.** `buildDocx(template, header, filled)` with no fourth
argument (`src/lib/export/docx.ts:549-557`, called from
`src/lib/ui/export.ts:533`) prints `section.title` verbatim (`:163-167`) and
groups crops by `slotDef.key` (`:169-178`). Renames, additions, deletions and
reorder all fall out of the resolved template. This is the largest dividend of
the overlay spine: the path an operator actually uses needs zero edits.

Two notes. An empty section still emits its heading (`:169-177`), which is right
for the sample's deliberately empty sections and equally right for an added judul
not yet filled. `{{quote}}` substitution stays a table-label feature (`:196`), so
an operator typing it into a title gets their quote number, which is harmless; no
escape hatch is added.

`groupByKey`'s hazard comment (`:142-148`) still names `SlotDef.crops`, which is
dead (`src/lib/forms/template.ts:59-91`). It is corrected in the same diff to
name the two live reasons: a discovered lanjutan chain, and an added judul's
picture stack.

### 8.4 `generate.mjs`'s docx-template path

`buildPatches` pairs `template.sections` with `manifest.sections`
**positionally** and verifies by **text**: section count
(`src/lib/export/docx.ts:342-350`), layout (`:363-370`), heading text
(`:377-387`), row count (`:399-405`), row label text (`:407-416`). Five hard
throws, all correct, none relaxed.

**`--sections` and `--template` are refused at argument-parsing time**, beside
the existing `--template` manifest check (`scripts/generate.mjs:783-798`):

```
--sections and --template cannot be combined. --template patches the
operator's own stripped Form Validasi, and its placeholders are paired with
the form's sections BY POSITION (buildPatches in src/lib/export/docx.ts).
A section list that differs from the one the template was stripped from puts
every crop after the first difference under the wrong heading, in a document
that opens cleanly. Drop --template to build the document from scratch with
these sections, or drop --sections to fill this template as it stands.
```

Two objections, both answered rather than ducked. *`buildPatches` already throws
on heading text, so why refuse earlier?* Because it throws after the whole run's
OCR and model spend, which is precisely what the early `loadDocxTemplate` read
exists to prevent (`scripts/generate.mjs:2057-2062`). *Why not let a rename-only
overlay through?* Because the manifest check compares heading text
(`src/lib/export/docx.ts:377-387`): comparing against the base title instead
would let the patch land and print the manifest's own heading, so the rename
would be silently discarded in the artefact a validator signs.

---

## 9. The operator UI

Every string here is Bahasa. Code, ids and comments stay English. Two hues only;
a saturated fill always carries dark ink; focus is ink; nothing under 13px;
uppercase is reserved for quoting the document; everything below moves with the
work and is therefore solid, never glass.

### 9.1 The eight direct reads, across five files

Counted in the tree on 2026-09-08: `grep -rn AO_TEMPLATE src/components/` returns
eight live reads to replace, plus one that stays (`export-panel.tsx:1829`), plus
comment mentions. `src/lib/ui/stub-runtime.ts:122` is a ninth read and is handled
by the seeding change in section 10.1, not by this memo.

One `useRunTemplate(run)` memo (`resolveTemplate(AO_TEMPLATE, run.overlay)`)
replaces the direct constant at `src/components/operator/contact-sheet.tsx:404`
and `:405`, `src/components/operator/export-panel.tsx:1195`, `:1209`, `:1278`,
`src/components/operator/operator-app.tsx:1273`,
`src/components/operator/outstanding-panel.tsx:261`, and
`src/components/operator/zone-editor.tsx:714`. `src/lib/ui/propose.ts` and
`src/lib/ui/extract.ts` take it as a parameter.

`src/components/operator/export-panel.tsx:1829` **keeps**
`AO_TEMPLATE.xlsxRows.length` as screen copy: that is a statement about the
ORDER_Config sheet, which is not per-order, and swapping it would print the same
number with a false implication.

A `wiring.test.mts`-style assertion lands with this step: no file under
`src/components/operator/` imports `AO_TEMPLATE` except for `xlsxRows`.

### 9.2 The word for a section

`docs/ui-bahasa.md:42` fixes **bagian** = a slot, and the shipped UI uses it that
way (`src/components/operator/contact-sheet.tsx:1019` builds `bagian-<key>`
anchors; `docs/ui-bahasa.md:55` says "a bagian nobody has looked past"). A section
needs its own word and must not borrow that one, because the destructive verb
lands on it.

**A section is a `judul`.** The word can also mean the heading text alone, so the
glossary entry defines it precisely and the controls are phrased so the ambiguity
never bites: the rename field is labelled **"Judul"**, never "Nama judul".

New glossary rows:

| concept | Bahasa | note |
| --- | --- | --- |
| one heading of the DOKUMEN VALIDASI **together with the bagian under it** | **judul** | never "bagian", which is one cell needing evidence |
| rename | **ganti nama** | |
| add a judul | **tambah judul** | |
| delete a judul | **hapus judul** | |
| hidden from this order | **disembunyikan dari order ini** | recoverable, because the base still declares it |
| a judul the AI proposes | **judul yang diusulkan** | ruled on with the usual Terima / Bukan ini |

### 9.3 The controls, on the lembar periksa

The sheet already lists every judul in resolved order and is where the judgement
"this judul is not in this order" forms. A separate manage-sections screen would
ask for that judgement twice.

Per judul heading, one always-present ink cluster, never hover-only, so a
keyboard reaches it:

| control | string |
| --- | --- |
| rename | **"Ganti nama"** |
| move up | **"Naikkan"** |
| move down | **"Turunkan"** |
| delete | **"Hapus judul"** |

Buttons, not drag: drag has no keyboard path. Rename opens an inline field in
flow, not a dialog: label **"Judul"** in the app's sans voice, helper
**"Teks ini yang tercetak sebagai judul di DOKUMEN VALIDASI."**, keys
**"Simpan"** / **"Batal"**. The typed value sits at 40% opacity until
`editSections` resolves, which is the `Mark` / `Paraf` `drawing` / `saved`
convention.

Per bagian row, the same cluster with **"Ganti nama"** and field label
**"Nama bagian"**.

At the foot of the sheet:

- **"Tambah judul"**, opening the same inline field with an empty value and the
  placeholder **"Salin judul dari halaman"**, plus the note
  **"Judul yang Anda tambahkan diisi dengan tangkapan satu halaman."** On commit
  it creates the `AddedSection` with one `AddedSlot`, **seeds that bagian's
  `SlotState` as `pending` immediately**, and opens the zone editor on the
  whole-page loop.
- **"Judul yang disembunyikan ({n})"** with **"Kembalikan"** per row, derived
  from the base minus the present ids so nothing is stored for it.

Seeding the state on add is not a detail. `blockingItems` pushes a blocking
`kind: "pending"` with `stateIndex: -1` for a fillable slot with zero captures
(`src/lib/ui/export.ts:405-419`), and a `-1` index is a row `collectBlanks`
deliberately renders with no button
(`src/components/operator/outstanding-panel.tsx:276-290`). Without the seed,
adding a judul blocks the export with a control that does not exist.

Provenance, one 13px ink-2 line under a non-base judul:
**"Judul ini Anda buat sendiri."** or
**"Judul ini usulan AI dari {nama berkas}."** Under a renamed base judul:
**"asalnya: KB (lanjutan)"**, derived from the base and stored nowhere.

### 9.4 What a destructive action asks

Three cases, each priced by a pure `sectionRemovalCost(run, template, id)` that
mirrors `sourceRemovalCost` (`src/lib/browser/sources.ts:77-90`) and shares the
arithmetic with the edit so the two cannot disagree. The confirm is a `Dialog`,
the pattern already used at
`src/components/operator/outstanding-panel.tsx:1267-1291`; its primary key is
`<Btn tone="reject">`, which is the tone that exists
(`src/components/operator/chrome.tsx:218`).

- **A judul carrying accepted potongan:**
  > **"Hapus judul {nama}?"**
  > "Judul ini memuat {n} potongan yang sudah Anda terima. Menghapus judul ini
  > membuang potongan itu dari berkas hasil, dan itu tidak bisa dibatalkan."
  > **"Hapus judul dan {n} potongannya"** / **"Batal"**
- **An added judul with no potongan:** always asks, because the name is work.
  > **"Hapus judul {nama}? Nama yang Anda ketik tidak bisa dikembalikan."**
- **A base judul with no potongan: no dialog.** One step plus a toast,
  **"Judul {nama} disembunyikan."** with **"Batalkan"**, because it is
  recoverable from the foot of the sheet and a confirmation for a reversible act
  trains the operator to click through the ones that matter.

The recovery line never promises the potongan back, only the name.
**"Kembalikan"** re-seeds empty bagian.

### 9.5 The berkas question and the usulan head

On each queue row and each berkas row
(`src/components/operator/ingest-panel.tsx:765-834`, mirrored in
`documents-bar.tsx` so it is reachable in every phase), two keys, not a
checkbox: a checkbox labelled "jangan cari" is a double negative to un-tick.

- **"Dibaca AI"** (selected by default) / **"Tanpa AI"**, the selected one
  carrying `--petrol`, because it is identity and interaction and a berkas nobody
  has decided anything about is not owed a decision.
- Under a "Tanpa AI" berkas, the sentence from 6.2. Every existing sentence about
  pages read and pages read short
  (`src/components/operator/ingest-panel.tsx:783-818`) stays, because a "tanpa
  AI" berkas is still read.

At the head of Periksa, beside the outstanding panel that already renders there:
**"AI menemukan {n} judul di berkas {nama}."**, one row per usulan carrying the
proposed title in the mono document voice, a `Cite` naming berkas, halaman and
baris, the halaman count, a `Denah` of the first page, an amber `Mark` because a
decision is owed, and **"Terima"** / **"Bukan ini"** / **"Ganti namanya"**. Gap
accounting when any: **"{n} halaman tidak diusulkan jadi judul mana pun."** And
**"Cari judul lagi"**, stated plainly as a repeat of a search rather than as a
free action, which clears `sectionsAskedFor`.

### 9.6 What happens to the mono-voice rule

AGENTS.md records that section titles and bagian labels are transcriptions
rendered in the mono document voice, *"which is why nothing offers to rename them
today"*, and that a design adding renaming must say what happens to that rule.

**The rule is kept, and its meaning is preserved by a new constraint rather than
by an exemption.** Mono means *this text is quoted from a document*, and that
stays true: a renamed judul is still a quotation, of a different order's
paperwork. What changes is who does the quoting, and the answer moves from
"whoever read the sample once per repo" to "the operator holding the scan", which
is strictly closer to what the voice claims. So:

1. titles and labels stay mono, before and after a rename, including case, since
   uppercase is reserved for quoting and this is quoting;
2. the app's chrome around them (the key, the field's own label, the helper, the
   confirm sentence) stays sans, 13px or larger;
3. **the field the operator types into is mono**, so they can see they are
   writing in the document's voice;
4. **the app never invents a name.** A rename field is seeded with what is there;
   an added judul's field starts empty with the placeholder "Salin judul dari
   halaman";
5. an AI-proposed title is a quotation **by construction**, because 5.4 rejects
   any title that is not a substring of the lines it cites.

Point 5 is what makes the rule survive contact with the AI stage instead of being
quietly abandoned by it. All five go into `docs/ui-bahasa.md`.

---

## 10. Migration

### 10.1 Runs already in IndexedDB

- **`overlay` absent is upgraded on read** by `loadRun`
  (`src/lib/browser/runtime.ts:381-383`) to `emptyOverlay(AO_TEMPLATE)`, which
  `resolveTemplate` short-circuits to `base` by identity. **Never written back on
  read:** a write on read bumps `rev`, can collide with an ingest in another tab,
  and turns "open an order to look at it" into a refusable operation. The upgrade
  is deterministic and lands on the next ordinary save.
- **`metaOf` (`src/lib/browser/runtime.ts:260-268`) must list `overlay`,** and
  because the field is required its return type stops satisfying `RunMeta` until
  it does. `newRun` (`:255-267`) seeds `emptyOverlay(AO_TEMPLATE)`.
  `src/lib/ui/stub-runtime.ts:122` does the same, and `wiring.test.mts` gains an
  assertion that the stub's run carries one.
- **`RunMeta = Omit<BrowserRun, "pages">` is stored whole**
  (`src/lib/storage/runs.ts:52`, `putRun`'s `const { pages, ...meta } = run` at
  `:514`), so the overlay round-trips with no field-by-field mapping.
  `toStoredPage` (`:227-238`) is untouched: pages did not change.
- **`RunSource.ai` and `sectionsAskedFor` absent** read as "searched" and "never
  asked", which reproduces today's behaviour for every stored run.
  `ingestDocument` writes `ai` from here on, the same way `digest` shrank its own
  gap (`src/lib/browser/types.ts:170-182`).
- **`baseFingerprint`** hashes the base's section ids and slot keys at overlay
  creation. A mismatch on resolve is **not** an error, because that would make
  old runs unopenable; it is one line on the sheet and a count on the export plan
  naming patches that reference nodes the base no longer has. It is honesty, not
  immunity (section 13).

`persistence.test.mts` pins: an overlay round-trips; a record with no overlay
reads back upgraded; a rename does not trip `CaptureLossError`; dropping an added
judul unnamed throws `SectionLossError` and naming it succeeds; an `appendPage`
during a rename does not revert it, and its **return value** carries the stored
overlay.

### 10.2 `removeSource`

`src/lib/browser/sources.ts:92-241` gains overlay handling and keeps its
three-field whitelist (`:198-209`) intact, because `SlotState` gained nothing:

- every `ProposedSection` whose `fromSourceId` is the removed berkas is dropped
  (a usulan, not work, so `SectionLossError` allows it);
- `pages` is dropped from any surviving `AddedSection`, because those are
  run-global positions the removal renumbers;
- an **accepted** added judul survives as a named judul whose capture 1 resets to
  `pending` through the existing whitelist. Deleting it silently is the exact
  loss section 3 exists to stop, and its name is not the berkas's property.
  `sourceRemovalCost` (`:77-90`) gains a line saying how many judul will be left
  empty.

### 10.3 `generate.mjs`

Default behaviour is byte-identical. Four additions:

- **`--sections <overlay.json>`**, validated by the same `assertOverlay` the
  route uses (one copy, the `NEVER_EXTRACTED` argument), then
  `resolveTemplate(AO_TEMPLATE, overlay)` once, replacing the references at
  `scripts/generate.mjs:2536`, `:2537` and the others.
- **`--no-ai <file.pdf>`**, alongside `--tambahan` (`:760-762`): rendered, OCR'd,
  appended to the global page list like any other document, and excluded from
  every pool and from classify.
- **`--discover-sections`**: runs section 5 over every supplied document and
  writes `<ID EPIC>_SECTIONS.json`. **It adds nothing to the docx**, following
  the precedent AGENTS.md already records for continuations: the detection half
  only, because a headless run has no operator to reject a crop, and a
  model-invented heading printed into a packet nobody reviews is the failure this
  project exists to prevent. The round trip is the review: a human edits that
  file and feeds it back as `--sections`.
- An added judul in `--sections` carrying `pages: [...]` is filled
  deterministically with whole-page captures, no model call, exactly as
  `layout: "images"` is. Without `pages` it ships as an empty heading and the run
  log prints a **`MANUAL (n)`** block, deliberately distinct from
  `OUTSTANDING (n)` (`:2668`), because an added judul was never searched and
  reporting it as not found is the same lie the route's `outOfScope` bucket
  exists to avoid.

`scripts/test-pipeline.mjs`'s `AO_TEMPLATE` assertions stay valid: the base still
exists and still says what it says.

---

## 11. Staging

Each step leaves `pnpm test`, `pnpm lint` and `tsc` green and is independently
shippable.

| # | Step | Why it is separable |
| --- | --- | --- |
| **S1** | `appendPage` writes and returns from `stored` (`src/lib/storage/runs.ts:630`, `:633`); `ingestDocument` keeps the returned meta. Persistence test. | Pure hardening, no feature. |
| **S2** | `SlotDef.ask`, `SectionDef.ask`, `SectionDef.id`, `SlotDef.pageOrdinal` in `template.ts`; `SlotQuestion` becomes `{key, ask}`; `findContinuations` takes `SlotAsk`; `handler.ts:369-370` and `:642-645`, `generate.mjs:1288-1291`, `measure-locate.mjs` follow. Prompt-byte equality tests. **Re-run `pnpm measure:locate`, three samples, replace the current column in AGENTS.md.** | Zero behaviour change by assertion, and the only step that goes near a prompt. |
| **S3** | `wholePageProposals` reads `pageOrdinal` (`handler.ts:209-215`). | Behaviour-identical on the base; makes deletion and restore safe before either exists. |
| **S4** | `overlay.ts`: types, `emptyOverlay`, `isEmpty`, `resolveTemplate`, `assertOverlay`, `assertNodeId`, `isSearchable`. Wired to nothing. | Pure, fully unit-testable. |
| **S5** | `BrowserRun.overlay` required; `metaOf`, `newRun`, `stub-runtime`, `loadRun` upgrade; round-trip tests. | Invisible. `tsc` names every site. |
| **S6** | `SectionLossError` + `removingSections` in `putRun`; `blockingItems` gains `"orphan"`; the "Buang potongan ini" remedy. | Nothing edits yet, so nothing can trip the guard. The orphan block is a fix on its own merits. |
| **S7** | The nine screens read `useRunTemplate(run)`; `wantedKeys` / `capturesToWalk` / `buildProposeRequest` take the template and filter on `isSearchable`; the label readers flip (`outstanding-panel.tsx:298`). | Large, mechanical, behaviour-identical while every overlay is empty. Must land before S8: it is what stops an added judul's key reaching the route. |
| **S8** | `src/lib/browser/sections.ts` + `runtime.editSections`; rename, reorder, delete, restore, add in the UI; the `undrawn` reason; seeding on add. **The feature starts existing here.** | No wire change, no model change. Deletion alone is most of the value, since the second bundle shares 2 of ~12 headings. |
| **S9** | The editor lanjutan loop, `DiscoveredCapture.status`, the two-key strip. | Client-only, free, no wire change. |
| **S10** | Per-berkas opt-out: `RunSource.ai`, `WirePage.searchable`, the filter in both routes, the control, the words. Carries a test that a run with nothing excluded produces a byte-identical request. | Additive; defaults to today. |
| **S11** | `ProposeBody.overlay`, `assertOverlay` on the wire, `ProposeResult.outOfScope` and `excludedSources`, the route's resolved default. | The belt behind S7's braces. |
| **S12** | `src/lib/pipeline/sections.ts`, the `discover` phase, `record-proposals` / `accept-proposal` / `reject-proposal`, the usulan head, the `sections` row in `src/lib/cost.ts`, `pnpm probe:sections`. | Last of the app steps, because it is the only one that spends new tokens and everything it produces is already renderable and reviewable by then. |
| **S13** | `generate.mjs`: `--sections`, `--no-ai`, `--discover-sections`, the `--template` refusal, the `MANUAL` block. | Headless parity; the UI is shipped and useful without it. |

---

## 12. What is deliberately not built

- **The operator cannot create a `layout: "table"` judul.** A table slot is the
  only thing that costs a locate call and the only thing that can return a
  plausible fragment of the right page, and what makes locate work is a `hint`
  written to beat a look-alike, which is prompt text AGENTS.md forbids retuning
  without the gate. Asking an operator to write one is asking them to move a
  measurement they cannot see. Cost: an order carrying a genuinely new field
  *inside* a page is drawn by hand. The operator sanctioned this; the second
  bundle's per-service rows are exactly the case it does not serve.
- **A base bagian's `hint`, `docType`, `fillable` and `layout` are not
  overlay-expressible.** This is what makes section 4.5's proof possible.
- **Bagian cannot be reordered inside a judul, or moved between judul.** See 1.2.
- **`xlsxRows`, `fieldHints` and `fieldLists` stay on the base**, and
  `/api/extract` is unchanged apart from the `searchable` filter. Cost: an order
  whose spreadsheet needs different rows cannot be served and there is no UI path
  to one.
- **No saved profiles.** Every order re-seeds from `AO_TEMPLATE`. Cost: an
  operator working a second bundle of the same client's paperwork redoes the same
  edits. The follow-up is one function plus a place to keep it, and guessing at
  the storage now is worse than leaving it out.
- **Discovery is not merged into `classifyPages`.** They are the same shape of
  question and could be one call, but classify is upstream of page selection,
  which is the gate's only stable signal (12/12 in every arm measured).
- **`checkForContinuation` is not used as a recommendation on a whole-page
  capture.** It would make the editor feel smarter and would be a fabrication
  (`src/lib/pipeline/continuation.ts:410-421`).
- **No new `SlotStatus`, and no bulk Terima for a discovered stack.** The second
  is a real cost (risk 4) and is deliberately deferred until the page-count
  number is measured rather than guessed.

### The honest cost of the overlay spine

1. **The base is a moving target.** If `AO_TEMPLATE` changes in the repo, every
   stored overlay re-interprets: a run finished last month reopens with a
   different starting suggestion under it. A stored full list would be immune.
   `baseFingerprint` makes it visible, not impossible.
2. **A rename cannot improve a proposal, and an operator will expect it to.**
   This is the sharpest edge in the design and the direct price of a checkable
   gate. The mitigation is the existing `catatan`
   (`src/lib/forms/template.ts:35-57`), which is operator-editable, says what the
   bagian is and what it is not, and can be reworded freely because no
   measurement depends on it. The rename field's helper says what a rename does
   and claims no more.
3. **The gate cannot measure an edited form, ever.** Locate accuracy is a claim
   about the base only. That was already half-true, since two bundles are not
   enough to claim accuracy; this makes it explicit, and it goes into AGENTS.md
   in those words rather than being discovered later.

---

## 13. The open risks that remain

1. **The `ask` fence is only as strong as the day someone adds an "edit hint"
   affordance.** Every accuracy statement in 4.5 rests on `SlotAsk` being
   unreachable from the UI and absent from the wire.
   *Closed by:* two tests that land with S4 and S11. `ui.test.mts` asserts that no
   `SectionEdit` produces a resolved template whose `ask` differs from the
   base's, for any edit and any sequence of edits. `propose.test.mts` asserts
   `assertOverlay` rejects any object carrying an `ask`, `hint`, `docType`,
   `layout`, `pageOrdinal` or `fillable` key at any depth. A future affordance
   therefore fails the suite rather than the gate.

2. **`MAX_SLOTS_PER_LOCATE_CALL` is one env var away from 1, and at any higher
   value a deletion reshapes a surviving prompt**
   (`src/app/api/propose/handler.ts:423-428`, `:628-645`).
   *Closed by:* a note in `src/lib/pipeline/locate.ts`'s header beside the dial,
   plus a test that skips itself with an explanatory message when the dial is 1
   and asserts pool-level prompt equality when it is not. Raising the dial
   without extending the equality test is then a visible skip, not a silence.

3. **Discovery has no gate row and two sample bundles cannot supply one.** Its
   failure mode is a plausible heading over the right-looking pages, which is
   this project's named failure class.
   *Closed by, in order:* the substring-of-cited-lines rule (5.4), which makes a
   fabricated heading structurally impossible rather than unlikely; per-judul and
   per-potongan acceptance, which is a process guarantee; and
   `pnpm probe:sections` over a whole bundle, which is what to run before anyone
   quotes a number. Not closed by a total, deliberately.

4. **Accepting one discovered judul over a long document seeds one `proposed`
   capture per page, and every one of them blocks the export**
   (`src/lib/ui/export.ts:400-441`). On the second bundle's 151 pages that is a
   review burden scaling with page count instead of field count, and nobody has
   measured what an operator will actually do at page forty.
   *Closed by:* an explicit measurement before S12 ships to an operator. Run
   `pnpm probe:sections` over the second bundle and count the accepted-judul page
   spans it proposes. If any span exceeds ten pages, the glossary's existing bulk
   verb (**"Terima semua {n} di {judul}"**) lands with S12 rather than after it.
   The number decides, not the design.

5. **The cost figures in 5.6 are arithmetic on a measured neighbour, not a
   measurement**, which is the exact shape of the media-resolution paragraph
   AGENTS.md records as wrong by an order of magnitude and as having sent one
   investigation at the wrong target first.
   *Closed by:* the `sections` row in `src/lib/cost.ts` and one
   `pnpm generate --discover-sections` run over the sample bundle, whose printed
   per-stage table replaces the estimates in this document and in AGENTS.md. The
   flat `cost:` guard keeps the two accountings from disagreeing.

6. **`baseFingerprint` reports a drifted base; it does not protect a finished
   order from one.**
   *Closed by:* the sheet line and the export-plan count, which name every patch
   pointing at a node the base no longer has, plus a rule written into AGENTS.md
   that changing a base section id or slot key is a migration and needs one,
   exactly as changing a `hint` needs a gate run. The fingerprint is what makes
   such a change loud instead of silent.

7. **Deleting a judul destroys its potongan irreversibly, and the recovery
   affordance sits a few centimetres away.** The dialog says so and the recovery
   line does not promise them back, but a design cannot prove copy is read.
   *Closed by:* the count in the dialog's destructive key
   (**"Hapus judul dan {n} potongannya"**, so the key itself carries the number),
   and the deferred follow-up named here so it is not re-derived: an undo buffer
   for the last section edit, out of scope now because it needs storage of its
   own and a rule about how long it lives.

8. **A "tanpa AI" berkas leaves no trace in the exported packet.** The screen
   self-corrects when the operator flips it back on, but a DOKUMEN VALIDASI
   exported while a berkas was excluded says nothing about it. The "operator is
   not the audience for our engineering" rule is about the interface, and this is
   arguably a fact about the document.
   *Closed by:* asking the client, not by guessing. Recorded here as an open
   question with a named default (no trace, matching today's packet) so that
   whoever asks knows what shipped.
