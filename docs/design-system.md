# Meja Kaca, the glass bench

The design system for tv-validator. `src/app/globals.css` and
`src/components/operator/chrome.tsx` are the implementation; this file is the
argument, so a later change can tell a decision from an accident.
`docs/ui-bahasa.md` holds the language.

**This is the third material this product has worn, and the first two were
rejected by the client in their own words.** Both are recorded below rather
than quietly deleted, because the reasons they failed are the only evidence
this one has for being right.

## The one idea

**The tool is glass, the work is solid.**

One gradient ground runs under the whole product, and everything on it is one
of two materials. Which one a thing gets is decided by a question anybody can
answer by scrolling the page:

- **Does it stay still?** Glass. The application strip, the phase rail, the
  documents bar, the interruption band, a sticky action footer, a toast, a
  hint panel, a dialog. Translucent, backdrop-blurred, a bright hairline along
  the top edge where the light catches, a soft drop beneath. This is the TOOL.
- **Does it move with the work?** Solid. Every slab, well, row, stage, mat,
  kotak and sheet. Opaque, matte, no blur, no drop. This is the DOCUMENT UNDER
  THE TOOL.

**The seam is deliberate because it is also the performance rule.** A
backdrop-filter inside a metre-long scrolling list is the most expensive thing
you can put in a page like this one, and the review sheet holds two dozen
panels. So "glass is what stays still" is not a taste, it is what keeps the
app cheap, and it is why the seam can be pointed at rather than apologised
for.

Three things make them one product rather than two: one light source (glass
takes a bright top edge, a solid panel a faint one, a control casts a hard lip
downward); one radius family, one type scale, one motion curve, one button;
and the solid panels are tinted out of the gradient's own hue, so a slab is
the ground condensed rather than a foreign colour laid on it.

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
to judge) stops being visible. On a dark ground every crop is a lit rectangle
with a hard edge. Functional, so it is not offered as a preference, and it
extends to the pages that show no scans so the product is one thing.

The privacy policy resolves the tension in the system's own terms: it is a
long document, so it is set on a sheet of paper on the bench, where reading is
best and the metaphor holds.

## Colour

The ground is a gradient, not a plane, and it is the first thing the client
asked for by name. It runs a real hue journey rather than one colour with
lighting on it:

| Token | Value | Role |
| --- | --- | --- |
| `--ground-1` | oklch(0.235 0.040 206) | teal, top |
| `--ground-2` | oklch(0.185 0.045 244) | blue, middle |
| `--ground-3` | oklch(0.140 0.030 264) | blue-black, bottom |
| `--glow-1` | oklch(0.375 0.063 196) | the light entering top-left |
| `--glow-2` | oklch(0.310 0.075 252) | the light leaving bottom-right |

58 degrees of hue with a glow in two opposite corners, which is what makes it
read as a lit ground rather than as a tint. The two glows are what the glass
has to refract; under `prefers-reduced-transparency` they are dropped and the
three-stop ramp stays, because the ramp is the product's ground and the glows
are an effect.

**Every ratio in the file is measured against the rasterised extremes**, not
against a stop: `--ground-hi` (#012c30) is the lightest pixel the three layers
can produce anywhere and `--ground-lo` (#030c1a) the darkest. Light ink is
checked against the lightest, because that is its worst case.

The solid planes are the ground condensed, all of them within the same hue
family:

| Plane | Value | Material |
| --- | --- | --- |
| `--surface-sunk` | oklch(0.185 0.030 244) | a recess: what the MACHINE read |
| `--surface` | oklch(0.190 0.045 244) | the bench itself |
| `--surface-raised` | oklch(0.315 0.030 232) | a block on the bench |
| `--surface-lift` | oklch(0.365 0.030 230) | a block nested in a block |
| `--surface-rail` | #173e42 | the opaque value glass becomes when it cannot blur |
| `--mat` | oklch(0.115 0.018 246) | the mount a scan is pinned to |
| `--paper` | oklch(0.988 0.004 91) | the only lit material |

**A lifted block is lighter than its ground and a set-in block is darker.**
That rule exists because the review sheet nests a slab inside a slab: the open
capture plate sits inside its section, and without an explicit ladder the two
were the same fill and the plate stopped reading as an object.

### The two hues, and how they may be worn

`--mark` (amber) means **a decision is owed here** and nothing else, ever.
`--gap` (red) means **a fault or a refusal** and is absent from a healthy
screen. Confirmed work carries no colour at all, so a finished packet is a
screen with the colour gone out of it.

**Neither may ever be a saturated fill under light text.** That is not a
preference, it is the client's rejection of the previous system quoted back as
a rule: *"lots of clashing colors like bright yellow and white text"*. They may
appear as a 4px rule down a block's leading edge, a 12% tint of the block's own
ground, a filled chip carrying dark text, a stroke, a glyph, or plain coloured
text. `--mark-ink`, `--gap-ink` and `--petrol-ink` exist for no other reason,
and there is no exception for a colour that looks dark enough.

`--petrol` is the third colour and it is **not a status**. It is identity and
interaction: the primary key, a link, and the step you are standing on. It is
deliberately not on the amber-red axis so that "this is the button" can never
be confused with "something is owed" or "something is wrong".

### The control is a pressed key

Generous radius, weight 700, a **solid lip** in a darker shade of the
control's own colour sitting hard beneath it with no blur, and a press that
moves the face down onto the lip until the lip is gone. 44px minimum. The lip
height is one token, `--lip-h`, used by the shadow, the reserved margin and
the press translate together, so the key cannot land beside its own shelf.

This is what the client meant by *"duolingo like button and components"*, and
the last clause is the half that is easy to drop: chips, toggles and the state
boxes share the roundness, so the family is legible as a family.

### Two materials the file rejected, and why

The first was **four steps of one graphite at chroma 0.011**. The client's word
was *monotonous*, and they were right: that is not a colour, it is a shade of
nothing.

The second was **Stempel Basah, the wet stamp**: hard offset plates with no
blur, 2px and 3px borders, full-width bars of solid ink, zero radius. It was
built to answer a real diagnosis, that the system was written entirely as
prohibitions and named nothing to look at. It over-corrected into a style the
client rejected as *"absolutely the wrong aesthetic"*, and its amber status bar
under white text is the specific object that produced the complaint above.

What survives from it is the STRUCTURE, which was never what was wrong: every
block is a block with a header, the header is the status channel, identifiers
sit in a ruled box, evidence is mounted rather than placed, and there are six
type steps and four spaces. Meja Kaca is that structure in a different
material.

### Defects this material fixed, all measured

Kept because each is a way of being wrong that will otherwise be re-derived.

- **Every piece of glass had no blur at all.** Written with the standard
  property first and `-webkit-backdrop-filter` second, Lightning CSS collapses
  the pair and emits ONLY the prefixed one. Chrome has no `-webkit-` alias, so
  `backdrop-filter` computed as `none` on a bare `.lt-rail` while the
  background from the same rule applied normally, and the whole liquid-glass
  half of the design was simply absent while looking deliberate. The prefixed
  property goes first now and the standard one last, everywhere.
- **The sticky chrome was 8.5% opaque over whatever was scrolling.** That is
  the right number for a panel, which floats over the gradient and nothing
  else. It is catastrophic for chrome, which on the review sheet floats over a
  white A4 scan: composited about #ebeeef, putting the phase rail and the owed
  count at roughly **1.1:1** for as long as a page of evidence passed
  underneath, then back to normal. `--glass-rail` is a separate material at
  90%, keeping the blur; worst case 8.1:1.
- **The amber status bar carried white text.** This is the client's complaint
  itself. The bar is now a 12% tint of the block's own ground with a 4px
  `--mark` rule down its leading edge, so a block that owes a decision still
  turns as a whole and no saturated fill ever carries light text.
- **`.lt-hatch` painted 30%-alpha stripes and its comment claimed 4.14:1.**
  The real figure was about 1.56:1: the quoted number was the token's ratio,
  not the painted stripe's. `Missing` in `denah.tsx` renders a hatched sheet as
  the ENTIRE representation of a capture with no evidence, so an unreadable
  hatch is a wrong-and-quiet surface built by the device meant to close one.
  Solid stripes now, and the comment says what the paint does.
- **The denah's "teks tidak terbaca" caption was 10px**, three sizes below
  anything else in the product, on the one device whose job is telling you a
  page could not be read.
- **`.lt-kop { overflow: hidden }` clipped a focus ring.** Two screens render a
  Hint button inside the bar and the global ring sits 4px outside the control.
  The leading rule is drawn with an inset shadow now, which follows the rounded
  corner by construction and needs no clipping ancestor.

### The measurement rule

Every ratio in `globals.css` is computed against the composite that actually
paints, never against a token. Glass is measured over the **rasterised
lightest pixel** of the gradient, a stripe is measured at its own alpha, a
nested panel is measured as two films, and a bar with a gradient over it is
measured including the overlay. Three separate verification passes on this
system each caught the same class of error: a comment quoting the ratio of the
colour the author wished were behind the text.

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

Each declares what it is. A control and a piece of evidence are physically
different objects, and the seam between glass and solid is the first thing to
check when adding one.

| Class | Material | For |
| --- | --- | --- |
| `.lt-rail` | glass, blurred, 90% | chrome that stays still while work scrolls under it |
| `.lt-toast` `.lt-hint-panel` | glass, blurred | transient, floating, never scrolls with content |
| `.lt-slab` `.lt-panel` | solid, `--surface-raised` | a block of work |
| `.lt-slab-flat` | solid, `--surface-lift` | a block nested inside a block |
| `.lt-well` `.lt-row` | solid, `--surface-sunk` | what the app READ: inputs, OCR text, technical detail |
| `.lt-mat` `.lt-stage` | solid, `--mat` | the dark mount a scan or crop is pinned to |
| `.lt-paper` | solid, `--paper` | a document: the sign-in, policy and failure sheets |
| `.lt-hatch` | solid stripes | a deliberate absence, on the record |

**Glass never scrolls with the content.** It is the rule that keeps the app
cheap and it is the rule that keeps the two materials meaningful; a blurred
panel in the review sheet's scroll would break both at once.

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

## What may hide behind a question mark

The client asked for less on screen. The trap is that this product's whole
argument is that a tell must be visible, so hiding a warning behind a hover
would be the wrong-crop failure delivered by the very control meant to tidy up.

**The rule, applied clause by clause and never paragraph by paragraph:**

> A line keeps the screen if a different order would print it differently, or
> if it is the reason a control on screen is refusing to work. It goes behind
> the question mark if it would read word for word the same on every order and
> everything it describes still works. Nothing set in `--gap` ever hides.

Most paragraphs here are one sentence that varies followed by one that never
does, and the whole win is in splitting them. That took the primary screen from
about 1300 words to about 750, and the first crop from roughly 1000px to about
340px on a 1366x768 laptop.

**What refused to move**, and this list matters as much as the other one: every
per-crop advisory (each is a measurement from *this* rectangle on *this* page),
the citation register and the denah, the reason a disabled control is disabled,
**consent statements about data leaving the device** even though they are
identical on every run, `Interruption` in every form, the affirmative clears
("Siap diekspor"), the completeness figure, and the state word on every row.

`Hint` in `chrome.tsx` opens on hover, on focus **and on tap**. A hover-only
control does not exist on a touchscreen and cannot be reached from a keyboard,
and this is a tool people use all day. The mark is ink, never `--mark`, because
amber means a decision is owed and a question mark owes nothing.

## The icon set

`src/components/operator/icons.tsx`, hand-drawn, no dependency. The governing
idea:

> **A verb icon is never a picture of the verb. It is the shape of what the
> verb leaves behind.**

`Terima` leaves a paraf, so the Terima button carries the paraf, drawn from the
same path constant the confirmed mark uses. `Bukan ini` leaves a coretan.
`Kosongkan` leaves a double-ruled empty cell. The button previews its own
outcome, which is a real information gain rather than decoration, and it is why
the set contains no pencil, no trash can, no tick in a circle and no chevron.

A **folded** corner means a file the operator supplied; a **square** corner
means a page inside the run. The page family is the denah at icon scale, so
somebody who has read the index rail for an hour can already read these.

Everything is `currentColor` and no icon may name `--mark` or `--gap` itself,
so "one hue, one meaning" stays a property of the system rather than a
convention fourteen files must remember. Grid: 20 units, 1.5 inset, stroke 1.5
with `vector-effect: non-scaling-stroke`, round joins, caps by stroke kind
(round for a mark a hand made, butt for a printed edge). Three sizes only.

**What must not get an icon** is as long as the set and is written at the top of
that file: the six slot states (`Mark` already gives them six shapes, and a
second vocabulary for the same six facts is worse than none), a page as such,
the phase nav, a padlock on a locked phase, notice tones, every row of a
homogeneous list, a glyph per slot or section (those names are the document
quoted verbatim), and the crop advisories.

## The constraint that outranks all of this

The browser talks to nothing but this app.
`performance.getEntriesByType("resource")` must show only this origin on every
page. `next/font` downloads at build time and serves from this origin, so it
is allowed; a `<link>` to fonts.googleapis.com, an icon font, a CDN
stylesheet, or a remote avatar is not.
