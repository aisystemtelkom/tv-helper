# Meja Periksa, the inspection table

The design system for tv-validator. `src/app/globals.css` and
`src/components/operator/chrome.tsx` are the implementation; this file is the
argument, so a later change can tell a decision from an accident.
`docs/ui-bahasa.md` holds the language.

## The one idea

**This application is a work surface, and documents lie on it.**

A crop of a scan is a piece of paper on the table. The privacy policy is a
sheet on the table. The sign-in form is a card on the table. Nothing else in
the interface is allowed to look like paper, catch the light, or cast a
shadow.

## What the operator does, in one sentence

Twelve to twenty-four times per order, every working day: look at a cropped
picture of a scanned Indonesian contract page and decide whether it really is
the evidence for the field named beside it.

Everything that makes that faster is worth screen space. Everything else is
furniture, and the old primary screen was more than half furniture.

## The failure being designed against

Wrong and quiet. A crash is cheap. A packet that opens fine, looks complete,
and carries a crop of the wrong page is expensive, because a human validator
signs it.

Three standing obligations follow:

1. **The picture must be big enough to judge**, and the question "is this the
   right page?" must be answerable by looking rather than by comparing digits.
2. **An unreviewed thing must never be able to hide.** Absence of a warning is
   not a confirmation, and a blank cell and a cell nobody looked at must never
   be the same picture.
3. **A decision is not made until it is on disk.** The operator gets one
   signal for both, not two separate observations.

## The hero: denah halaman

`src/components/operator/denah.tsx`. A plan of the page with the crop knocked
out of it: every OCR line drawn as a bar at its true position on a
page-shaped silhouette, and the cut rectangle over them.

This is the only device in the redesign that answers **"is this the right
page?" with a picture instead of a better-typeset number.** A bigger page
figure, a tabular column, a register block instead of a dot-joined string:
every one of those still asks the operator to already know what page 8 of 27
should look like and then to compare digits. That is a read, not a glance,
and the failure class is precisely a number that reads fine.

A signature block, a Pasal table, a printed email and a covering letter have
completely different line patterns, so a wrong page is recognised from the
shape before anything is read, and a crop that ran on into a running footer is
a rectangle visibly touching the bottom of the sheet. Stacked in the index
rail, a column of them turns a **systematic** failure (every crop landing at
the top of its page, three captures citing one page) into a pattern that
cannot be missed.

It is free: `StoredPage` already carries `widthPx`, `heightPx` and
`lines[].box` in IndexedDB, so it is one inline SVG. No bitmap, no blob URL,
no canvas, no network, no model call.

**The one way it could lie, and the rule that stops it.** A page whose OCR
returned nothing has no bars, and a plan with no bars looks exactly like a
plan of a blank page. That would be a new wrong-and-quiet surface built by the
thing meant to close one. A page with no lines renders as an outline with a
struck rule and, where there is room, the words `teks tidak terbaca`. A
capture nobody has searched yet renders as a hatched outline, a **different**
silhouette again, because on a fresh run that is every capture and it is the
first thing a new operator ever sees.

## Why the surface is dark, on every page

The content is white paper. A scan's own white ground bleeds into a white
interface, and the crop's edge (the exact boundary the operator is being asked
to judge) stops being visible. On a toned graphite every crop is a lit
rectangle with a hard edge. Functional, so it is not offered as a preference,
and it extends to the pages that show no scans so the product is one thing.

The privacy policy resolves the tension in the system's own terms: it is a
long document, so it is set on a sheet of paper lying on the table, where
reading is best and the metaphor holds.

The ground is deliberately **not a near-black**: oklch lightness 0.235 with a
faint green cast, because warm photocopy white on a blue-black ground reads
cold.

## Colour: two hues in the whole product

| Token | Means |
| --- | --- |
| `--mark` amber | A decision is owed here. Nothing else, ever. |
| `--gap` red | A fault or a refusal. Absent from a healthy screen. |

`--mark` is not focus, not the active phase, not a hover, not a drag target,
not a heading, and not a warning about a measurement. The old `--lt-mark`
carried five unrelated signals at once, which teaches an operator to read none
of them.

`--gap` is used as rules, strokes and text, **never as a fill**, so red never
becomes a background the eye adapts to and stops reading.

**Confirmed work has no colour at all.** It is an ink paraf in a ruled box. A
finished packet is a screen with no saturated colour left on it, and that is
the point: the remaining colour is the remaining work.

**Focus is ink, never amber.** A keyboard position is not a decision that is
owed, and letting them share a colour means a focused control reads as a slot
demanding attention.

### Ink

`--ink` 12.1:1, `--ink-2` 6.8:1, `--ink-3` 5.0:1, all measured against
`--surface-raised`, the lightest ground any of this text sits on. `--ink-3` was
0.622 and measured **3.7:1**, below AA, while carrying every advisory the
product depends on.

**The rule that follows: quietness is bought with size and position, never
with lower contrast, and safety copy never uses `--ink-3` at all.** Nothing in
the product is smaller than 13px, because every small string here is safety
copy.

## Typography

**Atkinson Hyperlegible Next** and **Atkinson Hyperlegible Mono**, self-hosted
through `next/font/google`. The choice is functional: the face was drawn by
the Braille Institute so no character can be mistaken for another, which is
the difference between `1` and `l`, `0` and `O`, and `rn` and `m` in a quote
number a validator signs.

**The split of the two is a voice, not a texture.**

- The **sans** is the application talking to the operator: prose, headings,
  buttons, state words, advisories, explanations.
- The **mono** is the document's own voice: the packet's section names and
  field names as the sample spells them (`KB (lanjutan)`, `Jangka Waktu`,
  `TTD Pejabat`), page and line numbers, sizes, counts, file names, quote and
  LOP identifiers, email addresses on the allowlist, and the wordmark.

The one-line test: **is this the app speaking, or the paper?** Reaching for a
monospace face to make a small label look technical is the habit this
replaces; the old UI set the slot key, the origin sentence, the section meta,
the nav pills and placeholder prose in mono, none of which is the paper
speaking.

**Uppercase is reserved for quoting the document**: `DOKUMEN VALIDASI`, and the
two rubber stamps. The interface never puts a label in caps to give it rank.
That single rule retires every tracked-out eyebrow in the tree and replaces it
with something that carries information. Positive letter-spacing appears in
exactly two places in `globals.css`, the wordmark and `.lt-stamp`, both of
which are quotations.

| Role | Face | Size | Weight |
| --- | --- | --- | --- |
| Owed-decisions count (one per screen) | mono | 2rem | 700 |
| Field name under judgement | mono | 1.375rem | 700 |
| Cited page figure | mono | 1.375rem | 700 |
| Screen and section title | sans | 1.25rem | 700 |
| Body, hints, advisories | sans | 0.9375rem | 400 |
| Labels, buttons, state words | sans | 0.8125rem | 600 |
| Register values, figures | mono | 0.8125rem | 400 |

**File names truncate in the middle, never at the end.** Real scan names here
discriminate at the tail: `PKS_..._2026 (2).pdf` against `(3).pdf`.
`shortenFileName` in `chrome.tsx`.

**Size is centimetres with a comma decimal**, because the audience is
Indonesian and holding A4. `cropSize` in `evidence.ts`. It is labelled `ukuran
di halaman` and it measures the region ON THE SCAN, never the picture as the
exporter places it: the docx fits images to the usable column, so the two agree
only while nothing is being scaled. A placed size, if one is ever wanted, has
to come back from the exporter.

## The six states: six shapes

One ruled box, one size, one fixed position. Colour is the second, redundant
channel; print the screen in greyscale and nothing is lost.

| State | Bahasa | Shape | Colour |
| --- | --- | --- | --- |
| `pending` | belum dicari | dashed box, empty | none |
| `proposed` | perlu diputuskan | solid box, flagged corner | `--mark` |
| `partial` | sebagian | split box, one half parafed | `--mark` |
| `confirmed` | diterima | the paraf stroke | none (ink) |
| `outstanding` | tidak ditemukan | struck diagonal | `--gap` |
| `unfilled` | sengaja dikosongkan | double rule | none |

`partial` is the state that ships a packet which looks complete and is short a
picture, so it **can never borrow `proposed`'s treatment**. It is a visibly
split box, and its plate draws the missing capture at full size rather than
hiding it. It also carries its count (`1 dari 2 potongan`) in the register,
where no neighbouring row holds a figure, so it survives a fast scroll.

The old `.lt-chip` gave `proposed` and `partial` the same amber pill.

## The paraf finishes when the write does

`Paraf` in `chrome.tsx` takes `drawing` and `saved`. The stroke draws on the
click and sits at 40% opacity until `saveRun` resolves; only then does it go
solid. A `StaleRunWriteError` or `PageLossError` retracts it and raises an
interruption naming the cause.

This codebase already refuses stale and page-losing writes, and until now the
operator had no signal that a decision reached disk at all. "My mark is there"
and "it is saved" become one gesture instead of two observations.

## Materials

Five, and each declares what it is. A control and a piece of evidence are
physically different objects.

| Class | Radius | Shadow | For |
| --- | --- | --- | --- |
| `.lt-rail` | 0 | none | chrome; never holds a fact you read for meaning |
| `.lt-well` | 4px | inset by value | things the app READ: inputs, OCR text, technical detail |
| `.lt-panel` | 6px | none | a genuinely grouped block; the exception, not the default |
| `.lt-paper` | 2px | **`--lift`** | a document: crops, page rasters, the sign-in and policy sheets |
| `.lt-hatch` | 2px | none | a deliberate absence, on the record |

**A block is the space between two rules.** `.lt-panel` is for forms and lists
that are genuinely one group. The old UI put the header, a form, a list and a
piece of evidence in the same 10px rounded rectangle with the same border.

`.lt-paper` owns the only shadow in the stylesheet. If a new component wants
one, the answer is no.

## The review plate

```
 [mark]  Jangka Waktu                                    perlu diputuskan
         Masa berlaku perjanjian, di pasal yang menyebut tanggal mulai
         dan tanggal berakhir. Bukan tanggal tanda tangan.

         +---------------------------------------+   halaman 8 dari 27
         |                                       |   +--------+
         |   THE CROP. PAPER, LIFTED, HARD EDGE. |   |  denah |
         |   As wide as the column allows.       |   |  with  |
         |                                       |   |  cut   |
         +---------------------------------------+   +--------+
                                                     berkas  PKS_...(2).pdf
         | Menutupi 87% halaman. Periksa apakah      baris   31-58 (28)
         | terbawa ke catatan kaki.        ukuran di halaman  16,0 x 6,4 cm

         > Teks di dalam area ini
         [ Terima ]  [ Gambar ulang ]  [ Bukan ini ]
```

Ordered by what a person must see, and the layout must hold this order:

1. **The crop**, large enough to read Indonesian small print.
2. **The denah**, so page identity is a shape.
3. **The field name**, in the packet's own voice, large: it is the question
   being asked, so nobody should re-read to know which field they are ruling on.
4. **What the field is supposed to be**, especially its "bukan ..." half. This
   is in `SlotDef` today and has never been on screen.
5. **The decision controls**, attached to the plate, below the picture,
   left-aligned to it, never in a fixed deck aimed at something off screen.
6. The citation register, then the transcript on demand.

Never show `entry.def.key` (`kb.paraPihak`) to an operator: system vocabulary
competing for the space the definition should occupy.

The transcript is a **closed disclosure**. OCR text can be right while the
rectangle is wrong, so judging by the text is exactly the shortcut that lets a
wrong page through. It had four times the crop's area.

**Size is an argument.** A capture that owes a decision is a full plate; a
settled one collapses to a proof and its caption line; a non-fillable slot is
one ruled line. The length of the sheet is the amount of work left. Because
the last pass before a validator signs is exactly when every crop must be
visible, the export screen carries every confirmed crop at full size, and the
sheet has an expand-all.

## Repeated judgement gets a keyboard

Twelve or more decisions per order, every day. `j`/`k` move between captures,
`1` terima, `2` gambar ulang, `3` bukan ini. **Focus must survive a decision**:
accepting currently unmounts the focused button and drops focus to `<body>`,
so the next Tab restarts at the top of the document. A decision key is inert
while that capture's crop is not on screen, because you cannot rule on
evidence you cannot see.

## How a blocking condition reads

- Count, noun, remedy, in that order, and a control that goes to the blocking
  items, named by their operator-facing label and never by key.
- **Attached to the control it disables**, in the same viewport at 1366x768. A
  disabled button never appears without its reason beside it.
- Blocking and advisory are different objects. A stop-toned rectangle beside a
  live button teaches an operator that stop means nothing.
- It clears **affirmatively**: "Siap diekspor" is a state, and an absent
  warning is not a confirmation.
- It is announced in a live region.

## Motion

One orchestrated moment, and it answers an action: **the paraf draws** on the
operator's click and completes on the write. The ingest film strip fills one
tick per stored page, which is information, not decoration.

Nothing else moves. One global `prefers-reduced-motion` guard at the end of
`globals.css` covers the primitives in `src/components/ui/` too, which
animated unconditionally.

## The chrome, and the three places nobody could reach

One application strip: the wordmark, the open run **named as a whole bundle**
(not `sources[0].name`), the signed-in account, and links to sign out, to the
allowlist when the role permits, and to the privacy policy. All three existed
and nothing linked to them: an admin typed the URL, the consent given at
sign-in pointed at a document that could not be opened from the product, and
there was no way to sign out of a 12 hour session on a shared office machine.

Any avatar is **locally rendered initials**. Wiring the Google `image` field
would fetch from `lh3.googleusercontent.com` and break this project's standing
proof that `performance.getEntriesByType("resource")` shows no host but this
one.

## Failure screens are part of the design

`src/app/` needs `not-found.tsx`, `error.tsx`, `global-error.tsx` and
`loading.tsx`. A mistyped URL, a thrown render inside the operator app and a
cold start against Firestore each produced an unbranded English default or a
blank white page.

Text written for a deployer is never shown to an operator in the same
paragraph. One pattern, used identically everywhere: an Indonesian sentence,
with variable names, paths and raw exception text behind a `Detail teknis`
disclosure (`TechnicalDetail` in `chrome.tsx`).

## The allowlist's sixty seconds

Removing an operator takes up to 60 seconds to propagate, and the old editor
made the row vanish instantly while discarding the success message. An admin
removed a departing employee, saw the row disappear, and believed access was
gone. It was not.

The row now stays in place, **struck by a single red rule** (`.lt-coretan`,
which is how a clerk voids a line so nothing can be written into it
afterwards) with a draining counter, and leaves only when the counter reaches
zero. Struck and still live, at the same time, which is the truth.

## Two screens that do not exist yet, and how to get them right

Recorded because both have an obvious shape that is wrong, and the obvious one
is what a later pass would reach for.

### The docx template is per-run, and must never be remembered

The exporter is being rewritten to patch a template built from a human-authored
Form Validasi rather than construct the document from scratch, which is what
recovers the header, the theme fonts and the table borders. It is headless for
now (a CLI flag), so there is nothing to build here yet. Two rules for when
there is:

- **NEVER PERSIST A TEMPLATE ACROSS RUNS.** Per-run or absent, never sticky.
  "Exported against last month's template" can only happen if something
  remembers one, so nothing may. That rules out "choose once and remember",
  which is the affordance that would feel most helpful and would be the bug.
- **Do not ask for a template.** Operators do not have templates; they have a
  previous Form Validasi for a similar order, which is a thing they actually
  keep in a folder. The field asks for that, and the template is derived from
  it. A screen that asks for an artifact nobody has is a screen nobody uses.

A missing or malformed template does NOT block the export. It falls back to the
built-in layout, which is what ships today and is usable, just plain. But the
fallback is **always stated**, never silent: a document that quietly came out
plain is the same class of problem as one that quietly came out wrong, only
cheaper.

### Jenis Order autofills, and must not be validated

`resolveJenisOrder` returns `{ value, origin, detail }`, where `origin` is one
of flag / env / request / inferred and `detail` is the sentence explaining
which, so it arrives as a value AND its provenance in the shape a citation
already has. It is pure and reads the OCR pages the run already holds, so it
costs no request and no round trip.

It is the best autofill candidate among the six header fields, for a reason
worth keeping: **the set of order types is small and its members are short
codes, so a wrong answer is visible to an operator in a way a wrong project
name is not.** `namaProyek` fails that test, which is why it stays blank.

**Do not validate the answer against a list of known codes.** AO, MO and DO are
the ones met so far and more exist; the inference is anchored on the printed
label rather than on a known set, so it can legitimately return a code nobody
here has seen. Rejecting it would silently drop a real order type, which is the
wrong-and-quiet direction. The field is already a `datalist` and not a
`select`, for exactly this reason, and it must stay one.

**There are FOUR origins to render, not three, and the fourth is the
interesting one.** Alongside flag / env / request / inferred there is
**refused**: the resolver saw something that looked like an answer and would
not trust it. That must not share wording with "we found nothing", because it
means the opposite in practice: the form has a jenis order printed on it and
the operator should go and look. "Tidak ditemukan" would send them away from
the one page that has the answer.

**And `inferred` earns weaker phrasing than the other three, on evidence.**
Reproduced over 22 real spellings, the first version of this inference was
wrong on nine. It answered `DAN` for "JENIS ORDER DAN LAYANAN", `YANG` for
"JENIS ORDER YANG DIMINTA", `BARU` for "Jenis Order Baru", and it read a blank
printed option menu, `JENIS ORDER  AO  MO  DO` with nothing ticked, as a
confident answer of `AO`. That last one is the shape to design against: an
autofilled value on a form where the operator had not chosen yet is worse than
an empty field, because an empty field asks to be filled and a filled one does
not. The rules were rewritten and the failures fixed, and the phrasing still
has to carry the difference between "this was stated" and "this was read off a
page".

## The constraint that outranks all of this

The browser talks to nothing but this app.
`performance.getEntriesByType("resource")` must show only this origin on every
page. `next/font` downloads at build time and serves from this origin, so it
is allowed; a `<link>` to fonts.googleapis.com, an icon font, a CDN
stylesheet, or a remote avatar is not.
