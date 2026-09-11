<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# tv-helper

Turns a bundle of scanned Indonesian telecom order documents into one
deliverable that reproduces a human-authored sample:

`<ID EPIC>_DOKUMEN_VALIDASI.docx`, a validation packet whose evidence is
**cropped pictures** of the source pages, in the manner of a screen capture
rather than a text quote.

The headless pipeline that produces it is built and merged. `pnpm generate`
runs it end to end with no UI and no browser involved.

## THE PROGRAM NEVER AUTHORS A SPREADSHEET, AND NOW AMENDS ONE

**This section reversed on 2026-09-09 and the previous version is quoted below,
because the half that survived is the half a reader is likeliest to drop.**

It used to say: *this program must never generate, write, offer or read a
spreadsheet*. That was recorded the same day the client's next instruction
narrowed it, and the two are not in conflict once the subject is named. The
banned thing was a **deliverable the tool authored from nothing**:
`<ID EPIC>_ORDER_Config.xlsx`, the EPIC order-entry sheet with column E filled
from the scans, plus an `.xlsx` INPUT path (`--request`, `--service`,
`src/lib/pipeline/order-request.ts`) that supplied values deterministically and
removed those keys from what the model was asked for. The client confirmed the
workbook was a miscommunication and that Excel was never meant to be an input
*of that kind*. All of that is still gone: `src/lib/export/xlsx.ts`, the
order-request reader, the `answered` parameter on `/api/extract` that only that
reader produced, the browser's second download plate, the attachment path's
spreadsheet converter, and the `exceljs` dependency itself.

**What Konfig Excel does instead is not that.** The operator hands over the EPIC
order-configuration workbook they already have; the tool reads it, checks every
field of it against the scans, and offers back **their own file with named cells
amended**. It never authors a workbook, never decides its structure, and never
fills a cell nobody ruled on.

- **`exceljs` IS STILL NOT IN `package.json` AND MUST NOT COME BACK.** Neither
  must `xlsx` (SheetJS), which is separately disqualified and whose
  disqualification the reversal does not touch: frozen on npm at 0.18.5 with two
  unpatched HIGH advisories whose fixes ship only from the vendor's own CDN.
  `src/lib/xlsx/` reads and patches OOXML directly over `jszip`, which the
  lockfile already pinned for `docx` and which moved to `dependencies` for this.
- **THE WORKBOOK IS PATCHED, NEVER REBUILT**, and that is the load-bearing half.
  `patchWorkbook` edits the named cells inside the operator's own bytes and
  leaves every other zip part alone, so the formatting, the data validations and
  the print settings EPIC's template carries all survive. A regenerated workbook
  would lose them in a file that opens cleanly, which is this project's failure
  class wearing a spreadsheet.
- **THE MODEL NEVER INVENTS A CELL.** `locate.ts` shows OCR lines and takes a
  LINE RANGE back; this shows the workbook's real cells with their real
  addresses and takes a CELL ADDRESS back. Every address is checked against the
  grid, and a label whose text is not the text standing at the address it cites
  is dropped with a reason -- the same anti-fabrication rule
  `src/lib/pipeline/sections.ts` applies to a judul title.
- **"STRUKTUR EXCEL RANDOM" IS THE CLIENT'S OWN WORDING AND IT IS LITERALLY
  TRUE.** Three real workbooks read on 2026-09-09 are laid out three different
  ways: labels down column C with values in column E; headers across row 2 with
  one data row per service; and fully transposed, with `Nomor`/`Item I`/`Item
  II`/`Keterangan` as ROW labels down column B and the field names running
  ACROSS columns E to AN. Nothing hard-codes any of them and nothing may. One of
  them stores dates as serials (`46255`), so the reader resolves number formats
  through `styles.xml` or the operator meets a five-digit integer where a date
  belongs.
- **`Template.fieldRows` is a different thing and is still NOT a sheet.** It was
  `xlsxRows` and was renamed with the deleted workbook. `fieldKey` declares which
  values a document may be searched for; `nomor`/`itemI`/`itemII`/`keterangan`
  are the operator-facing NAME of the row, which is how an outstanding entry
  says "Contact Last Name" rather than "picContacts". It is not derived from,
  and does not derive, the operator's workbook.
- **Extraction stayed**, because the docx HEADER TABLE is filled from it
  (`namaProyek`, `cc`). Two declared keys, `picContacts` and `alamat`, are
  still extracted and now reach nothing; that is known and was accepted rather
  than overlooked.
- `Konfigurasi (Excel dari EPIC)` is a JUDUL of the packet -- a whole-page
  capture of the client's own EPIC screen -- and is still unrelated to any of
  this. It is evidence in the DOKUMEN VALIDASI; Konfig Excel's workbook is an
  input to a different check. Do not merge them.

**`pnpm dev` now serves the OPERATOR UI, not the chat.** `src/app/page.tsx`
renders `<OperatorApp />` behind the auth gate. The assistant-ui chat that used
to live there is gone: its vendored components were deleted and nothing renders
a thread any more. The screens run on the REAL runtime -- real files, real OCR,
real proposals through `/api/propose`. This paragraph used to warn that they
were driven by a stub; that stopped being true and the warning outlived it, so
check `src/lib/ui/wiring.test.mts` rather than trusting either version of this
sentence.

**What is left of the chat scaffolding is one live route and a set of orphans.**
`/api/chat` still works, is still gated, and is still the only part of the
application that sends images to the model (`pnpm smoke`'s vision probes
aside) -- so do not read its cost profile as the pipeline's -- but nothing in
this app calls it any more. `src/lib/threads/`, `src/lib/attachments/` and
`src/lib/storage/indexeddb.ts` are imported by nothing outside their own
directories: they belonged to the deleted chat UI. Several gotchas below
(`createLocalStorageAdapter`, the attachment `accept` list,
`DEFAULT_PAGE_LIMIT`) are about that dead code and are kept only so that
reviving it does not re-derive the same bugs.

**There is no local fallback.** Ollama is not deployed to production, so it is
not kept as a code path either. `GOOGLE_GENERATIVE_AI_API_KEY` is required and
every entry point fails loudly without it. **This now includes OCR**, which
used to be the exception: recognition is a Gemini vision call, so a dev with no
key can no longer ingest a document at all. `OCR_ENGINE=tesseract` keeps the
local engine for the two scripts while it survives; the browser has no such
switch and never will.

## The failure class this project cares about

Wrong-and-quiet. A crash is cheap. A DOKUMEN VALIDASI that opens fine, looks
complete, and carries a crop of the wrong page is expensive, because a human
validator may sign it. Most rules below exist because some earlier version of
this code produced a plausible wrong answer instead of an error.

## How the pipeline works

The central idea: **the model is never asked for a pixel coordinate.** OCR
supplies every word with a real glyph box; the model is shown those words
grouped into numbered lines, as text, and answers with a *line range*. The
rectangle is then the union of those lines' own boxes. The model does only the
semantic step, which is the part a language model is good at.

| Stage | Module | Produces |
| --- | --- | --- |
| Render | `src/lib/pipeline/render.ts` | one upright RGBA page at 300 DPI (`DEFAULT_DPI`). `getViewport` applies the page's own `/Rotate` (these scans carry `/Rotate 270`), so every box downstream is upright pixels and no other module thinks about rotation. The 2D context is injected via `CanvasFactory`, so Node passes `@napi-rs/canvas` and a browser can pass an OffscreenCanvas without this module importing either. |
| OCR | `src/lib/pipeline/ocr.ts` | every word with a pixel box, Indonesian (`ind`) by default |
| Geometry | `src/lib/pipeline/geometry.ts` | `groupWordsIntoLines` (vertical-overlap grouping), `unionBoxes`, `padBox`, `boxForLineRange` |
| Classify | `src/lib/pipeline/classify.ts` | doc-type spans (`KB`, `SP`, `BAPermintaan`, `Email`, `Unknown`) from OCR text. Rejects any reply that does not cover every page exactly once: nothing downstream confirms these spans, so a gap or an overlap must fail loudly. |
| Locate | `src/lib/pipeline/locate.ts` | `{pageIndex, from, to, confidence}` for one slot. The box is the union of those lines' boxes padded by `CROP_PADDING_PX` (12px, about 1mm at 300 DPI). |
| Extract | `src/lib/pipeline/fields.ts` | docx header values, each with a citation that is **validated before it is trusted** (a hallucinated page, a reversed range, or a line the page does not have drops the citation but keeps the value: a false citation is worse than none) |
| Crop | `src/lib/export/crop.ts`, `png.ts` | the rectangle cut out of a re-rendered page, PNG-encoded with no image dependency (no `sharp`, no `pngjs`) |
| Export | `src/lib/export/docx.ts` | the deliverable |

`src/lib/forms/template.ts` (`AO_TEMPLATE`) declares the docx section list and
the field row list together, because they are two views of one order.
`fieldRows` is still a **transcription of the sample**, and so is the two-part
KB table split. The SECTION LIST is not, any more -- see below.

### What the constructed packet looks like, and who decided

Four things, asked for on **2026-09-11** and transcribed from
`lab/dokumen-validasi-breakdown/`. **They apply to the CONSTRUCTED path only.**
The `--template` path patches the operator's own stripped Form Validasi, which
already carries its own header, fonts and section order; rebuilding any of that
there would destroy the thing that path exists to preserve.

- **A navy `DOKUMEN VALIDASI` banner heads every page**, from
  `header-example.docx`: a floating `wps` rectangle anchored to the PAGE (it is
  7.78in wide against a 6.92in text column, so anchoring it to the column would
  clip it), `#44546A`, white bold caps at 14pt with 1pt letter-spacing.
  `bannerHeader` builds it with docx's own `WpsShapeRun` -- no OOXML surgery.
- **The order details sit at the top of page 1**, shaped like
  `order-details-example.docx`: bordered, labels bold and right-aligned against
  their values, that file's own column widths scaled to the usable column
  (it declares 10272 twips of table inside a 9968-twip column and overruns the
  page it was measured on). The six values are the `HeaderFields` this table
  always printed; only its shape changed.
- **Calibri 12 throughout, judul included.** A judul is distinguished by WEIGHT
  alone, because docx's built-in Heading2 is Calibri *Light* at 13pt in blue --
  a different font in a different size from the two things asked for.
- **One page per judul and capture, for captures not in a table.** Every
  `layout: "images"` capture takes a page of its own; a table judul flows, with
  `keepNext` on its heading and `cantSplit` on every row so a bagian's label
  and its evidence cannot be split apart.

**SO THE PAGINATION RULE IS ABOUT ADDED JUDUL, and after the four-judul cut it
is about NOTHING ELSE.** `AO_TEMPLATE` declares no `layout: "images"` section
at all any more, and `resolveAdded` is the only thing that makes one. A packet
built from the base form alone is the order-details page and four table judul;
every whole page in it comes from a judul somebody added or accepted.

**THE JUDUL LEADS EVERY PAGE, and that is why.** `resolveAdded` labels the
bagian under an added judul `Halaman 1`, `Halaman 2`, ... -- a POSITION, not a
name -- so titling a page with the slot label alone prints "Halaman 2" over a
capture and drops the heading the operator typed. `captureHeading` puts the
judul first and lets the position qualify it, and only once there is more than
one page to tell apart. A label that already opens with its judul is used as it
stands: that rule outlived the `SP`/`SP (lanjutan)` pair it was written for, and
is kept because `resolveAdded` cannot promise a label that does not.

**VERIFIED IN WORD, NOT ONLY IN XML**, because an XML assertion cannot say
where Word decided to break a page. Driven over COM on **2026-09-11** against a
packet of the four base judul plus three added ones, 10 captures, and it came
back 8 pages:

| page | what Word reported |
| --- | --- |
| 1 | the order details, alone |
| 2, 3 | `Kontrak Induk (Halaman 1)` and `(Halaman 2)`, one picture each |
| 4 | `KB`, its four rows and their four pictures |
| 5, 6 | `KB (lanjutan)`: the table spans the break, every ROW intact |
| 6 | both Konfigurasi judul and their empty rows |
| 7 | `Lampiran Teknis`, one picture, and NO `(Halaman 1)` on it |
| 8 | an added judul with no capture yet, holding its page |

with the banner reporting `#44546A` at 560x22.3pt and `Normal` and `Heading 2`
both reporting Calibri 12. Page 7 is the qualification boundary in one line: a
judul holding one page is not told which page it is.

### `AO_TEMPLATE` IS FOUR JUDUL, AND ONLY KB IS SEARCHED

**It used to transcribe all twelve of the sample's judul, and on 2026-09-11 it
stopped.** What it declares now, in order:

| judul | layout | bagian |
| --- | --- | --- |
| `KB` | table | Nomor, Para Pihak, Tanggal, Jangka Waktu -- all fillable |
| `KB (lanjutan)` | table | Detail, ToP, TTD Pejabat -- all fillable |
| `Konfigurasi (Excel dari EPIC)` | table | SID, Konfigurasi -- none fillable |
| `Konfigurasi` | table | `{{quote}}`, Price & SA, BW, BA -- none fillable |

`BA Permintaan`, `SP`, `Email`, `MOM`, `BA Splitting`, `SBR Pricing`, `BASO`
and `BA Penjelasan Order` are **GONE from the base form**. They arrive per
order, from judul discovery or `Tambah judul`.

- **A DECLARED JUDUL IS A REQUIRED ONE, which is the whole reason.** Declaring
  it seeds a capture, searches for it, and reports `tidak ditemukan` when the
  order has no such document -- a word fixed to mean SEARCHED AND NOT FOUND,
  which sends the operator to fetch a berkas that was never going to exist.
  The operator's report, 2026-09-11: *"Anything outside of KB shouldn't be
  rigid required field."* The two sample bundles share **two headings out of
  about a dozen**, so this file already held the measurement that says a
  transcription of one order's packet was never the form.
- **IT ALSO PRODUCED A DUPLICATE HEADING THE TOOL COULD NOT SEE.** `BA
  Permintaan` took page 1 of a berkas as a whole-page capture; discovery read
  the same page and proposed `BERITA ACARA PERMINTAAN ORDER` out of it; the
  operator got one document under two headings. `recordProposals` screens a
  usulan against `overlay.added` ONLY (`fullyClaimedBy`), so a base judul
  cannot suppress one. **No screening rule was added for it** -- with those
  judul gone there is nothing left to collide with, since every surviving
  judul is either KB (crops inside a page, never a whole-page claim) or
  title-only.
- **`Konfigurasi (Excel dari EPIC)` and `Konfigurasi` survived because the
  operator asked for exactly those two to keep shipping.** They print as a
  heading over their own labelled but EMPTY rows and are filled from EPIC by
  hand after the packet is written. A deliberately empty cell is the
  deliverable.
- **NOTHING IN THE BASE FORM IS `layout: "images"` ANY MORE.** That path is not
  dead: `resolveAdded` gives every bagian under an added judul exactly that
  layout, so `wholePageProposals` in `src/app/api/propose/handler.ts`, the
  whole-page branch of `scripts/generate.mjs` and `SlotDef.pageOrdinal` all
  stay live and stay covered by `propose.test.mts` fixtures. Do not delete them
  because `AO_TEMPLATE` no longer reaches them.
- **`orderPaperworkDocTypes(AO_TEMPLATE)` now returns `[]`**, and that changes
  nothing: it ranks the pool for a backed fieldKey with no `FIELD_DOC_TYPES`
  entry, the only such key is `namaProyek`, and `NEVER_EXTRACTED` stops that
  one before it is asked. An empty list is an UNRANKED pool, never a smaller
  one. `scripts/test-pipeline.mjs` pins both halves.
- **A stored order made before this still holds its `ba.permintaan`, `sp.1`,
  `sp.2` and `email.1` states.** They become orphans: the outstanding panel
  lists them as *"potongan tidak punya tempat di dokumen ini"* with **Buang
  potongan ini**, and one carrying a zone BLOCKS that order's export until it
  is discarded. That is the machinery `unmatchedStates` and `blockingItems`
  exist for; there is deliberately no migration.

**An order still renames a judul, drops one, reorders the packet, and adds one
the form does not name.** That is what makes the short base form liveable:

- The edits are a **DIFF, not a copy of the form**:
  `TemplateOverlay` in `src/lib/forms/overlay.ts`, stored on the run.
  `resolveTemplate(AO_TEMPLATE, overlay)` is the one pure resolver, and it
  returns the base **by identity** for a run that edited nothing -- so every
  run made before overlays existed behaves byte for byte as it did, and a fix
  to a hint reaches an old order instead of being frozen out of it.
- **AN OVERLAY CANNOT CARRY A PROMPT.** `assertOverlay` refuses `ask`, `hint`,
  `docType`, `layout`, `fillable` and `pageOrdinal` **at any depth**. That is
  the fence, and it is structural rather than a convention: the measurement
  gate is the only thing that can tell a prompt gain from a prompt regression,
  and an operator renaming a heading on a Tuesday cannot run it.
- **An added judul is always whole-page captures.** `AddedSection` has no
  `layout` field at all. A `layout: "table"` bagian would be a slot the model
  is asked to locate inside a page, and nothing an operator can supply is what
  such a slot needs: a hint written to beat a look-alike anywhere in the
  bundle, and a gate run proving it does.
- `resolveTemplate` **does not read `overlay.proposed`**. A heading the model
  suggested is structurally unable to reach the docx exporter until a person
  moves it into `added`. There is no code path from a proposal to a
  deliverable.

### `SlotDef.hint` IS NOW `SlotDef.ask.hint`, AND IT IS FROZEN

Every prompt builder composes its question out of `SectionDef.ask.title` and
`SlotDef.ask.hint`/`ask.label` -- `buildLocatePrompt` and
`buildPoolLocatePrompt` (`src/lib/pipeline/locate.ts`),
`buildContinuationPrompt` (`src/lib/pipeline/continuation.ts`),
`slotSearchLabel` (`scripts/generate.mjs`) and `askedAs`
(`scripts/measure-locate.mjs`). `SlotDef.label` and `SectionDef.title` are what
the operator sees and the docx prints, and they are overlay-editable.

**RENAMING A BAGIAN THEREFORE CANNOT MOVE A PROMPT, and that is a compiler
property rather than a rule to remember.** Before the split, four prompt
builders read `label` and `hint` as sibling strings on one type, so a rename
would silently have rewritten two live prompts and the gate's own question --
with nothing in the way but a sentence in this file that the person doing the
renaming cannot read and could not act on if they did. Now a builder handed a
`SlotDef` no longer finds a `hint` on it, and one handed a `SlotAsk` cannot see
the editable name at all.

`SlotDef.catatan` is the third string and the reason the split is liveable: it
says what a bagian is **to the operator**, in Bahasa, and may be reworded
freely because no measurement depends on it. `ask.hint` is a prompt and cannot
do that job.

### `pnpm generate` routes on `section.layout`, and that is load-bearing

A `layout: "images"` section is a **whole-page capture**: a human filling the
sample screenshots the entire page, so the page is taken directly and **no
model call is made**. Asking the model to find a whole page inside that page is
a category error, and it is exactly how those slots failed the first
measurement run: a plausible-looking fragment every time. Only `layout:
"table"` slots go through `locateSlot`.

**`AO_TEMPLATE` DECLARES NO `images` JUDUL ANY MORE, and this routing is not
therefore dead.** Every judul an order ADDS resolves to `layout: "images"`
(`resolveAdded`, and `AddedSection` has no field to override it), so the branch
is what fills them -- see `--discover-sections` and the `pages: [...]` rule
below. It is also what the next base form to declare a whole-page bagian will
need. Do not collapse it because the shipped form happens not to reach it.

Two other things in `scripts/generate.mjs` that are easy to "simplify" back
into bugs:

- **Two passes, on purpose.** Pass 1 OCRs every page and keeps only the text
  geometry; the pixels are dropped. A 300 DPI A4 page is about 35MB of RGBA and
  the sample bundle is 29 pages, so holding them all costs a gigabyte to serve
  a dozen crops. Pass 2 re-renders only the pages a zone landed on.
- **OCR is cached, model replies are not.** OCR is keyed by the source file's
  content **hash** plus page and DPI, in the system temp directory, because it
  is a pure function of the pixels and takes minutes. Content-addressed, so a
  re-export cannot serve stale text: different pixels, different key. A model
  reply is not a pure function of its input, and a stale verdict served
  silently is worse than paying again. `GENERATE_FORCE=1` bypasses the OCR
  cache. **The gate harness caches the opposite way round; see below.**

### The four flags that give `pnpm generate` the per-order form

Default behaviour is byte-identical without them.

- **`--sections <overlay.json>`** applies a `TemplateOverlay`, validated by
  **the same `assertOverlay` the route runs** (one copy: a second validator is
  a copy that can silently disagree, and the two would agree on every overlay
  anybody tested). `resolveTemplate` runs ONCE and the result replaces every
  `AO_TEMPLATE` reference in the run.
- **`--sections` and `--template` ARE REFUSED TOGETHER, at argument-parsing
  time.** `--template` patches the operator's own stripped Form Validasi, and
  `buildPatches` pairs its placeholders with the form's sections **BY
  POSITION**: a section list that differs from the one the template was
  stripped from puts every crop after the first difference under the wrong
  heading, in a document that opens cleanly. Refused at parse time rather than
  at export because `buildPatches` throws only after the whole run's OCR and
  model spend, which is what the early `loadDocxTemplate` read exists to
  prevent. Do not relax any of `buildPatches`' five checks.
- **`--no-ai <file.pdf>`** fences one document off from the model, matching the
  browser's **tanpa AI**. It is rendered, OCR'd and appended to the global page
  list like any other -- so its pages can be cited and cropped by an added
  judul that names them -- and it is excluded from classify and from every
  search pool, `locate` and `extract` alike. The filter is on the page's own
  `searchable` flag and **never on `lines.length`**: an empty page and a fenced
  page are different facts and one of them is a decision somebody made.
- **`--discover-sections`** runs the discovery stage over every searchable
  document and writes `<ID EPIC>_SECTIONS.json`. **IT ADDS NOTHING TO THE
  DOCX**, following the precedent this file records for continuations: the
  detection half only, because a headless run has no operator to reject a crop
  and a model-invented heading printed into a packet nobody reviews is the
  failure this project exists to prevent. The answers land in that file's
  `proposed` array, which `resolveTemplate` never reads, so **feeding the file
  straight back changes nothing** and the run says so out loud. The round trip
  IS the review: a human edits it and passes it back as `--sections`.

**An added judul carrying `pages: [...]`** is filled deterministically with
whole-page captures, no model call, exactly as `layout: "images"` is. **Without
`pages` it ships as an empty heading and the run log prints a `MANUAL (n)`
block**, deliberately distinct from `OUTSTANDING (n)`. That distinction is not
cosmetic: everything in the outstanding list means "we looked and found
nothing", and both its consumers act on that -- the log tells the operator to
supply a dokumen tambahan, and a resumed run reads it to know what to search.
An added judul was NEVER SEARCHED, so reporting it as not found is the same lie
the route's `outOfScope` bucket exists to avoid. The UI's word for it is
**belum digambar**.

## ONLY THE OCR STAGE SENDS IMAGES

This is the single easiest thing to get wrong about this repo, and the cost
tables below read backwards if you get it wrong. **It inverted with the Gemini
OCR migration; anything you remember about it from before is now wrong by
roughly an order of magnitude.**

- **Classify, locate and extract are still provably text-only.** `Ask` is typed
  `(prompt: string) => Promise<string>` in `classify.ts` and has no image
  parameter anywhere in `src/lib/pipeline/`. The image-capable
  `AskImage` is declared in `gemini-ocr.ts` and nowhere else, precisely so this
  stays confirmable by reading one line.
- **OCR does send images: one rendered page image per page.** Under
  `OCR_ENGINE=gemini`, `pnpm generate` and `pnpm measure:locate` each upload
  ~29 page images for this bundle, and every browser ingest posts one per page
  to `/api/ocr`.
- **`GEMINI_MEDIA_RESOLUTION` IS NOT THE DOMINANT COST LEVER, and this bullet
  said it was for weeks.** It is about 4% of a run. Measured 2026-09-03 on the
  sample bundle: image input is ~36k of a run's ~460k tokens, so moving HIGH to
  LOW saves roughly Rp 800 a bundle and pays for it in exactly the small print
  the product exists to read. The bullet was arithmetic on a remembered
  per-image figure, never a measurement, and it sent at least one cost
  investigation at the wrong target first. The two real levers are named below.
- **THE DOMINANT LEVER IS WHICH MODEL READS THE SCANS.** OCR is the only call
  whose legitimate reply is long, so it is billed almost entirely on OUTPUT,
  and `gemini-3.5-flash` charges $9.00/M output against `gemini-3.5-flash-lite`'s
  $2.50/M. OCR is roughly half a bundle's bill. `OCR_MODEL_ID` exists for this
  and is a separate binding from `MODEL_ID` precisely so the cheap tier cannot
  leak into a judgement a validator signs.
- **The second lever is the size and ORDERING of the OCR listing.** One locate
  call carries every page of the pool as numbered lines: measured at **23k**
  input tokens for this bundle, not the 17k this file used to say. All seven
  fillable table slots share one pool, so that listing was uploaded seven times
  per run. It is now the prompt's leading text, which lets Gemini's implicit
  prefix cache serve it at 10% of the input rate; measured 57% of a run's input
  tokens served cached, taking locate from $0.27 to $0.11.
- **Seven, not thirteen.** `AO_TEMPLATE` has 13 `layout: "table"` slots but
  only **7 are `fillable`**, and all 7 carry `docType: "KB"`. Counting table
  slots instead of fillable ones overstates locate's cost. (It was 7 of 20
  before the form was cut back to four judul; the 7 did not move, which is why
  the cost table below still holds.)
- The per-image numbers in the cost table are correct and now apply to the
  validator path as well as to the chat route and the smoke test.

**`pnpm generate` prints a PER-STAGE cost table, priced, not just a token
total.** `src/lib/cost.ts` owns the price table and the arithmetic; the run log
carries the stage that spent the money, its share, the model that served it,
and how much of the input the provider served from its prefix cache. The flat
`cost:` line is still printed and a guard fails loudly if the two accountings
disagree. Read the table before proposing a saving: the reason this file was
wrong about media resolution is that a total cannot say which stage spent it.

An unknown model id prices as `unpriced`, never as free, and the table's date
is printed with every figure. Add a model to `PRICES` when you point
`MODEL_ID` or `OCR_MODEL_ID` at it.

`Stage` is a CLOSED UNION, so a new call site has to declare which row it
belongs in and cannot land in an "other" bucket nobody reads. **`sections` is
the newest row** -- judul discovery, one call per berkas, billed per berkas
rather than per run and gated by `RunSource.sectionsAskedFor`. It is its own
row rather than folded into `classify` although the two eat the same diet: "what
did asking for judul cost" and "did the cost gate work" are questions a merged
row could not answer. **It is not in the measured table below**, which is a
real run's printed output from before the stage existed;
`pnpm generate --discover-sections` prints its own.

## The measurement gate

`pnpm measure:locate` (`scripts/measure-locate.mjs`) scores the locate step
against the human-authored crops in the sample DOKUMEN VALIDASI docx. It reads
gitignored client material from `documents/` and calls the real model, so it is
run by hand, not in CI.

Ground truth is not a hand-picked phrase: each of the twelve crop PNGs is
OCR'd with the same `ocrToLines` pipeline used on the full pages, so the
comparison is real text against real text from the same engine.

**Recorded result: a transcript, not a computation.** Nothing in the tree
recomputes these, so the only way to tell them from stale ones is to run the
command again. THEY ARE ENGINE-SPECIFIC AND BOTH ARE KEPT, because the pair is
the only thing that says whether the OCR migration cost accuracy:

| | tesseract | gemini, 2026-09-02 | gemini, current |
| --- | --- | --- | --- |
| Total | 11 / 12 | 12 / 12 | **11 / 9 / 11** |
| Field slots (model-located) | 7 / 8 | 8 / 8 | **7 / 5 / 7** |
| Whole-document (no model) | 4 / 4 | 4 / 4 | 4 / 4 |
| Page selection | 12 / 12 | 12 / 12 | 12 / 12 |

**THE CURRENT COLUMN IS THREE NUMBERS BECAUSE THE SCORE IS NOT STABLE, and a
single number there was itself a measurement error.** Three runs of the
identical prompt on 2026-09-03 scored 11, 9 and 11. `KB / Nomor` (answering
[9,12] against a [2,12] crop) and `KB / Detail` ([2,42] against [2,46]) each
failed in the 9 run and passed in the other two. `locate.ts`'s own header used
to claim the answers move but the total holds; that stopped being true, most
likely when `INFLATION_MULTIPLE` was added as a third independent failure
condition on the same day.

So **do not quote a one-run gate total, and do not read a one-point difference
as a result.** Sample each arm at least three times and compare the sets. Page
selection is the stable signal: 12/12 in every run of every arm measured so
far, including both candidate OCR models.

**THE MIDDLE COLUMN IS KEPT AS A WARNING, NOT AS A RESULT.** It was measured
honestly and then stopped being true, because the continuation work changed
locate behaviour and the gate was not re-run -- the exact rule this file states
two paragraphs down, broken by the person who wrote the paragraph. It was then
recorded here as current and quoted to a peer session as the state of the tool.
The current column is the one to believe, and the way to tell is that it names
its date.

- The current miss is `KB / ToP (2)`, and the row was rewritten to measure what
  production actually does: it now walks forward from `KB / ToP (1)`'s answer
  through `findContinuations`, with the template's own hint, instead of running
  a wide search with a hint this harness invented. The continuation feature had
  no gate coverage at all before that.
  It still fails, informatively: the walk answers `[2,15]` where the human crop
  is `[0,15]`, and lines 0-1 are the PAGE LETTERHEAD. The product returns the
  clause exactly; the human additionally captured the furniture above it. Do
  not widen the product to include letterheads -- `runningFurniture` exists to
  exclude them. The open question is whether the GATE should compute containment
  against the crop's CONTENT lines. That moves every row and needs its own
  measurement.
- `KB / ToP (1)` was failing HALF THE TIME on a defect the cache hid, and it
  now passes. See `clampRangeToPage` in `src/lib/pipeline/locate.ts`.
- **RE-RUN AND REPLACE THE CURRENT COLUMN** when the engine, a constant, a hint
  or the prompt changes. Do not add a fourth. The reason the middle column went
  stale is that it stayed true of something.
- It is twelve crops, not the eleven the original design names: `SP` and `KB /
  ToP` each supply two crops on two *different* pages, so each needs its own
  `locateSlot` call.
- **FOUR OF THE TWELVE NOW MEASURE A PATH THE BASE FORM NO LONGER TAKES, and
  the harness cannot tell you so.** `BA Permintaan`, `Email` and both `SP` rows
  are the whole-document rows; they carry **no `slotKey`**, so `askedAs` never
  looks them up and the gate kept running unchanged when `AO_TEMPLATE` dropped
  those judul on 2026-09-11. They still score the SAMPLE's own crops honestly
  and they still cover the whole-page path an ADDED judul takes, so they were
  kept rather than deleted -- but "Whole-document (no model) 4/4" is no longer
  a statement about the shipped form. **The eight model-located rows all carry
  a `slotKey`, all of them `kb.*` or `kbLanjutan.*`, and every one still
  resolves**, which is why that cut owed no gate run: it moved no prompt and
  removed no slot the gate asks about.

The bundle those numbers are measured over is **29 pages**: the merged
contract scan is 27 and the SPLITBA scan is 2. 27 is the merged PDF alone,
never the bundle. Confirm with pdf.js against `documents/` rather than
quoting either number from here.

**The pass rule is containment, and the old "at most 2 extra lines" tolerance
is dead.** That absolute allowance was invented while writing the 2026-08-30
design with no data behind it. The sample's twelve human crops run from 2 lines
to 43, so +2 is a 100% overshoot budget on the smallest and 5% on the largest:
it measures nothing consistent. The rule now (2026-08-31 corrections, §3) is
that a proposal passes when it lands on an accepted page and its line range
contains every line of the ground-truth crop, with overshoot capped
*proportionally*: reject a range more than twice the required line count, or
one that runs the full page when the crop does not. Before quoting a total from
the harness, check which rule it is actually applying.

**Never re-tune the locate prompt or a slot `ask.hint` without re-running the
gate.** It is the only thing that tells a gain from a regression, and the whole
failure class here is a change that looks better and is worse.

### THE RECORDED COLUMN MEASURES THE BASE FORM ONLY, AND ALWAYS WILL

`pnpm measure:locate` scores twelve human-authored crops out of one sample
DOKUMEN VALIDASI against `AO_TEMPLATE`, and **it reads no overlay, ever**. That
is deliberate rather than a gap: the twelve crops are the yardstick, so letting
a per-order edit move the question would move the ruler and the thing measured
at once.

**So no number here is ever a statement about an EDITED form**, and there is no
way to make one: an order's judul list is that order's, its added judul are
whole-page captures the model was never asked about, and its renames cannot
reach a prompt by construction (see `SlotAsk`). What the gate measures is the
one thing an operator's edits cannot move, which is why the fence around
`ask` exists at all.

**AND THE BASE FORM IS NOW ALMOST EXACTLY WHAT THE GATE SCORES.** Cutting
`AO_TEMPLATE` back to KB plus two title-only judul left its seven fillable
bagian as the only searched ones, and those are precisely the eight
`slotKey`-bearing ground-truth rows (ToP supplies two). The four whole-document
rows are the remainder, and the bullet above says what they now measure.

**AND THE GATE IS OWED A RUN.** The `hint` to `ask.hint` rename is a
prompt-builder change, so this file's own rule applies to it. Its byte-identity
was verified **deterministically over all 24 `AO_TEMPLATE` slots** -- every
`ask.label` and `ask.title` is seeded verbatim from the `label` and `title`
beside it, and `scripts/test-pipeline.mjs` pins that they still agree, so every
prompt the builders compose is the same string it was. That is a proof about
the STRINGS and it is not a gate run. **`pnpm measure:locate` has NOT been
re-run since the split**, because it needs real client documents out of
`documents/` and live model calls. It is owed, three samples, and the current
column stands unverified against the renamed builders until somebody pays for
it.

### The gate harness's three caches

**THIS SECTION USED TO DESCRIBE A HAZARD THAT NO LONGER EXISTS, and the stale
version was scarier than the truth.** It said the OCR caches were keyed by role
plus page index, had no bypass, ignored `FORCE_FRESH`, and had to be deleted by
hand. All four claims were checked against the code on 2026-09-03 and none of
them holds. Verify in `scripts/measure-locate.mjs` rather than trusting either
version of this paragraph.

- **All three caches are content-addressed and all three honour the bypass.**
  The page-OCR key is `role:sha256(pdf bytes):page:engineTag`, the crop-OCR key
  is `sha256(docx bytes):imageName:engineTag`, and the model-reply key is
  `slotName:sha256(prompt)`. `MEASURE_LOCATE_FORCE=1` is read by all three
  lookups, not just the model-reply one. Re-exporting a document misses by
  construction, so there is nothing to delete by hand.
- **The engine tag carries the OCR model id and `OCR_PROMPT_VERSION`**, so
  switching `OCR_MODEL_ID` re-reads the bundle instead of scoring a new model's
  answers against the old model's page text.
- **`MODEL_ID` is deliberately NOT in the model-reply key**, and that is the one
  remaining sharp edge. A prompt change invalidates it by construction because
  the prompt is what is hashed, but a *model* change alone does not. Under
  `OCR_ENGINE=tesseract`, where page text is model-independent, swapping
  `MODEL_ID` and re-running would serve the previous model's locate replies
  while the banner named the new one. Pass `MEASURE_LOCATE_FORCE=1` when
  changing only the reasoning model.
- **`GEMINI_THINKING_LEVEL` and `GEMINI_MAX_OUTPUT_TOKENS` are in no key at
  all.** Changing either needs `MEASURE_LOCATE_FORCE=1`.
- **Ground truth is read by `MODEL_ID`, never by `OCR_MODEL_ID`.** The twelve
  crops are the yardstick, so letting a candidate read them would move the ruler
  and the thing measured at once. This also sidesteps a measured failure:
  `gemini-3.5-flash-lite` read all 29 full pages cleanly and then refused one
  crop outright with `finishReason=RECITATION`, deterministically, through six
  retries and a 30s backoff.
- **`GEMINI_MEDIA_RESOLUTION` is not read by this harness at all**, so its image
  calls may bill at a different tier than the app's. Its cost line is not the
  app's cost line.

`pnpm generate`'s OCR key is also the file's content hash, and `GENERATE_FORCE=1`
bypasses it. `GENERATE_CACHE_MODEL=1` additionally caches model replies for the
re-run loop; it is off by default, its key carries the model id, the thinking
level and the output cap, and any run that served from it says so loudly,
because a cached run is not a measurement.

Read the model-located number on its own. The harness reports field slots and
whole-document slots separately, because folding the deterministic full-page
captures into one headline would flatter the design by counting work the model
never did.

## The tool must be document-agnostic

The client's instruction, recorded 2026-08-31: *the tool is document-agnostic
and looks for the same slots in any document.*

- **The slot list does not vary by order type.** `JENIS ORDER` values are
  workflow verbs, not billing periods or document variants: **AO** = Activation
  Order, **MO** = Modify Order, **DO** = Delete Order, and more exist. An
  earlier version of this design treated "varies by jenis order" as an axis;
  that was wrong and the question was uninformed.
- **Do not assume the sample bundle's structure**, page ordering, or which
  document type carries which field.
- **The tension is real, so know it before you touch the pools.** Narrowing a
  field's search pool by `DocType` was introduced to fix a live defect:
  searching everything made `cc` match the printed email's own `Cc:` header, so
  both deliverables shipped a wrong customer name. The correction requires that
  narrowing become an *ordering hint*, never a hard filter, and the replacement
  is a better `hint` (for `cc`: the customer named as the subscriber on an
  order request, explicitly not a name appearing in an email header or
  distribution list), not a narrower pool. Whichever shape you find in the
  tree, changing it means re-running the gate.
- `namaProyek` is deliberately excluded from extraction entirely
  (`NEVER_EXTRACTED` in `src/lib/pipeline/extract.ts`, which
  `scripts/generate.mjs` re-exports) and ships blank. On the full pool it
  reliably picked the Surat Penunjukan's subject line, the master contract's
  scope title rather than this order's project name, and carried a citation
  that *passed* validation, in the docx header's `NAMA Proyek :` cell. A
  blank invites the operator to fill it in; a plausible wrong
  value does not. Verify the current state with
  `git grep -n "NEVER_EXTRACTED" src/lib/pipeline/extract.ts`, whose first hit
  as the tree stands is
  `export const NEVER_EXTRACTED: ReadonlySet<string> = new Set(["namaProyek"]);`.
  It moved out of the script so `/api/extract` could share the one copy: a
  second `NEVER_EXTRACTED` is a copy that can silently disagree with the
  first. The command this paragraph used to give pointed at
  `scripts/generate.mjs` and returned nothing at all, which reads exactly like
  the guard having been deleted.

  **This was re-enabled once and reverted.** The hint now rules the agreement
  title out by name, and one manual run showed it no longer answering with the
  master contract -- but that same run recorded the answer as the request
  email's subject line, which the run itself described as not the wording the
  sample uses. Differently wrong is still wrong for a cell a validator signs.
  The bar for removing it from the set is a reproducible run that yields the
  right value, not a better-sounding hint.

## Gotchas that will cost you time

### OCR and tesseract

- **Self-host the tesseract wasm and traineddata.** No `.traineddata` ships
  inside `tesseract.js` or `tesseract.js-core`; it comes from
  `@tesseract.js-data/*` and the library fetches it from a CDN by default,
  which puts an unapproved third party in the browser's request path. Same
  rule, same reason, as pdf.js keeping its bundled worker.
  `scripts/vendor-ocr.mjs` copies both into `public/tesseract`.
- **`vendor-ocr.mjs` guards on asset CLASS (wasm and traineddata), not on a
  file count.** A count-based guard passes while copying only JavaScript,
  leaving the CDN fallback in place for exactly the two things the rule exists
  to keep local. Paths are resolved through `createRequire`, never hard-coded:
  under pnpm nothing is hoisted, so `node_modules/tesseract.js-core` does not
  exist and a literal path silently copies nothing.
- **`pretest` AND `prebuild` both run `vendor:ocr`.** `prebuild` alone is not
  enough: without `pretest` a fresh clone gets two silent 30-second test
  timeouts instead of a green suite, because two tests point at the real
  `./public/tesseract`.
- **tesseract.js has no raw-pixel path.** It writes the bytes to a virtual file
  and calls `SetImageFile`, which needs a decodable header, so raw RGBA
  silently becomes a zero-length buffer. Encode PNG first. That is why
  `src/lib/export/png.ts` exists at all.
- **tesseract.js@7 swallows a `loadLanguage` rejection with a bare `.catch`, so
  a misconfigured asset path HANGS FOREVER** with no exception and no log line.
  `ocr.ts` wraps worker init in a timeout (30s default) for that reason, and
  the timeout message names `langPath`/`corePath`/`workerPath` and
  `pnpm vendor:ocr` because that is nearly always the cause. The timeout wraps
  **only init**, never recognition, which legitimately takes many seconds on a
  300 DPI scan.
- **Pass `cacheMethod: "none"` in Node.** Otherwise tesseract.js decompresses
  the vendored `.traineddata.gz` into `process.cwd()` and leaves it there.
  `gzip: true` must agree with what `vendor-ocr.mjs` writes, or the fetch 404s.

### A page read short (`checkPageCompleteness`, `keepShortPage`)

`ocrPageCompletely` compares the recogniser's boxes against the page's own ink
and refuses a page that leaves a stretch of it unread, because a short page
yields a plausible wrong line range, a plausible wrong crop and a citation a
validator signs. Two thresholds, both in `src/lib/pipeline/gemini-ocr.ts`:
`MIN_INK_COVERAGE` (0.90) and `MAX_UNCOVERED_INK_RUN_SHARE` (0.06).

- **THE THRESHOLDS WERE CALIBRATED ON BUNDLE ONE AND DO NOT GENERALISE
  CLEANLY.** Measured over all 151 pages of bundle two on 2026-09-04 with Cloud
  Vision (`pnpm probe:pages`): **7 pages fail** -- 39, 45, 48, 70, 72, 134 and
  150. There is no empty band
  to sit in. Uncovered-ink run passes at 5.8%, 5.4%, 5.3%, 5.2%, 5.1%, 4.8% and
  fails at 6.2% and 6.3%; ink coverage passes at 0.903, 0.905, 0.906, 0.909,
  0.911 and fails at 0.878 and 0.872. On bundle one the same two estimators
  separated 0.539 from 0.985-1.016. So a page missing by 0.3 of a percentage
  point is not distinguishable from a stamp, a signature or a page frame the
  recogniser correctly declines to transcribe.
- **AND YET TWO OF THE SEVEN ARE REAL**: one page returned 20 lines covering
  48% of its ink, and one returned NOTHING over a page carrying ink, which is a
  drawing. Loosening the numbers enough to pass the marginal ones would pass
  those two in silence. **Do not retune either constant without re-running the
  probe over a whole bundle**; a single page proves nothing either way.
- **THE BROWSER KEEPS A SHORT PAGE AND `pnpm generate` STILL THROWS**, and the
  difference is whether anybody is there to be told. Every crop in the app is
  confirmed by a person before it can reach a deliverable; the script writes
  its files unreviewed. `keepShortPage` in `src/lib/browser/ingest.ts` is the
  decision, and it lives there rather than in `pipeline.worker.ts` because that
  module opens with `scope.addEventListener` and no test can import it.
- **VERIFIED END TO END on 2026-09-04**, driving the real `ingestPdf` and the
  real `ocrPageOrKeepShort` over the real 151-page document with Cloud Vision:
  **151 of 151 pages ingested, 7 kept short, 166 recognition calls.** That last
  number is the arithmetic of the whole design in one line: 151 pages, plus two
  extra attempts each for the 7 short pages (the ladder is spent before a page
  is kept), plus exactly one retry that recovered a transport timeout. Before
  the change the same document stopped at page 39 and stored nothing.
- **A KEPT PAGE IS NOT A QUIET PAGE.** It carries `PageShortfall` in
  IndexedDB, its `Denah` draws a `--mark` ring and says `sebagian tidak
  terbaca`, the film strip counts it and names its page numbers, and every
  crop cut from it carries an advisory. The Task 7 rule was "never a silent
  thin page", not "never a thin page".
- **ONLY A CLEAN LADDER IS KEPT.** If any attempt threw rather than read short
  (`IncompletePageError.lastError`), the page still ends the document: a 503 or
  an aborted request may be a broken deploy, and carrying on through one would
  turn that into a bundle of quietly half-read pages.
- **`toStoredPage` in `src/lib/storage/runs.ts` maps field by field so a new
  `StoredPage` field fails to compile there rather than being silently dropped
  on read. AN OPTIONAL FIELD DEFEATS THAT**, which is how `short` was written,
  stored and then thrown away on the way back out with nothing failing.
  `persistence.test.mts` pins the round trip because the type cannot.
- **Under Cloud Vision the three-attempt ladder is waste.** It was written for
  Gemini, whose sampling can differ; Vision is deterministic, so
  `scripts/generate.mjs` passes `attempts: 1` and the browser does not. A page
  that trips the guard in the browser therefore costs three page charges to be
  told the same thing three times. Not yet fixed: the browser cannot see which
  engine the route chose.

### Handing berkas over (`src/lib/browser/intake.ts`)

The operator adds documents ONE AT A TIME WHILE AN EARLIER ONE IS STILL BEING
READ, and both halves of that sentence are load-bearing.

- **The drop target no longer stands down during an ingest.** It used to be
  replaced by the progress block, and its key went down with "tunggu sampai
  pemuatan selesai" on it, so an operator who found the SPLITBA four minutes
  into a 27-page contract had to stand and watch. Berkas handed over now join
  an ANTREAN in `operator-app.tsx` and are read in turn.
- **The invariant that refusal was protecting is kept exactly: ONE INGEST AT A
  TIME, in the order the berkas were given.** `BrowserRun.pages` is
  append-only because `Zone.pageIndex` is a position in it, so two concurrent
  `ingestDocument` calls on one run would interleave their pages and race each
  other's revisions. `draining` (a ref, not state) is the whole mechanism: every
  hand-over calls `drain()`, and only the one that finds the flag down runs.
- **The queue is a REF that the loop consumes and a STATE that the screen
  draws.** A drop lands while the loop is between two files, and React state
  read there is a value from a superseded render. Every write sets both, through
  `setQueueTo`.
- **A HAND-OVER THAT VANISHES IS THIS PROJECT'S FAILURE CLASS IN THE
  INTERACTION LAYER.** The operator walks away believing the SPLITBA is in the
  order and the bagian living in it ship `tidak ditemukan` on the record. So
  everything accepted and unread is listed BY NAME the moment it is accepted,
  a failure keeps the rest of the antrean rather than discarding it
  (`Lanjutkan pemuatan`), and every refusal is printed in prose.
- **A DOCUMENT THIS ORDER ALREADY HOLDS IS REFUSED, AND IDENTITY IS THE BYTES.**
  `sha256` of the file, stored as `RunSource.digest`. A renamed copy
  (`scan (1).pdf` out of a downloads folder) is the same document and a name
  check cannot see it; two different documents sharing a name
  (`document.pdf` from two emails) are NOT the same document and refusing the
  second would ship every bagian inside it as `tidak ditemukan`. That case
  stays an advisory on the ingest screen, never a refusal.
- **What a second copy actually costs, which is why this is not tidiness.** The
  run reads back as a longer bundle, the model gets two identical candidates
  for every slot and answers correctly with one of them, and then the operator
  removes the copy: `removeSource` renumbers every surviving zone, and the crop
  a human accepted was cut from the copy that just went. Nothing crashes.
- **`digest` is OPTIONAL and absent means UNKNOWN, never "unique".** Runs
  ingested before this existed have nothing to compare, so they match nothing
  and block nothing. Matching two blank digests against each other would refuse
  a document the order does not have.
- **SCREENED IN THREE PLACES, AND NONE OF THEM IS REDUNDANT.** (1) At the
  hand-over, against sources + antrean + the berkas being read, which is the
  refusal the operator experiences. (2) Again at the instant of appending,
  because hashing is async and two hand-overs a moment apart are each screened
  against a list neither has been added to yet. (3) In `ingestDocument`, inside
  the run lock, against what is STORED -- the only one that can see a second
  tab, and the only one that decides whether bytes land. It throws
  `DuplicateDocumentError`, which the drain loop catches per-berkas: a refusal
  stops ONE document, where a real fault stops the loop.
- **A DOCUMENT ANOTHER ORDER HOLDS IS NOT REFUSED, IT IS POINTED OUT.**
  `findInOtherOrders` in `intake.ts` uses the same byte identity and draws the
  opposite conclusion, on purpose: one customer's master contract recurs across
  their orders, so the berkas is still loaded, and the ingest screen names the
  other order, what that order calls the file and when it was made, and links
  to it (`Reused` in `ingest-panel.tsx`, and in the tambahan dialog). Three
  things about it are load-bearing. **It sees THIS DEVICE ONLY**, because orders
  live in this browser's IndexedDB and nowhere else, so the sentence says "di
  perangkat ini" and a silence never reads as "never used anywhere". **The link
  opens a NEW TAB**, because nothing in the workspace listens for `hashchange`:
  a same-tab `#run/<id>` rewrites the address bar and leaves the current order
  on screen, a live-looking link that does nothing, and a new tab also leaves
  any ingest running here untouched. **The data rides on `listRuns`**, whose
  `RunSummary` now carries each order's `documents` with their digests, rather
  than a second read of every order on the device.
- **`screenDocuments` and `screenDigested` are one rule split at the hashing**,
  so passes (1) and (2) cannot come to different answers. A hand-built Map in
  the component was the first version of pass (2) and was a second rule.
- **`crypto.subtle` needs a secure context, and so does `crypto.randomUUID`,**
  which this app already uses for every run, source and page id. That is the
  whole argument against a fallback digest: a second algorithm would give one
  document two identities depending on which context read it.

### On-device storage (`src/lib/storage/runs.ts`)

- **A run carries a `rev`, and a write that is behind is REFUSED.** `putRun`
  replaces a run wholesale, so a `BrowserRun` captured before a long ingest
  does not carry the pages that ingest appended -- and saving it deleted every
  one of them and resolved successfully. `putRun` and `appendPage` now compare
  `run.rev` against what is stored **inside the write's own readwrite
  transaction** and throw `StaleRunWriteError` on a mismatch. Keeping the read
  and the write in one transaction is the whole mechanism: a check done in a
  separate transaction, or in `runtime.ts`'s per-run lock, does not see a
  second tab at all.
- **So `saveRun` returns the run, and the caller MUST keep it.**
  `setRun(await saveRun({ ...run, slots: next }))`. The object passed in is one
  revision behind the moment it resolves; saving it again throws. A caller that
  ignores the return value works exactly once.
- **A missing `rev` is treated as revision 0, never as a waiver.** That is what
  lets a hand-built run create a run that does not exist while never being able
  to overwrite one that does, and it upgrades records written before runs
  carried a revision at all.
- **`PageLossError` is the second, independent net.** Even at the right
  revision, a write that does not carry every stored page is refused rather
  than deleting the difference. `BrowserRun.pages` is append-only because
  `Zone.pageIndex` is a position in it, so there is no legitimate single-page
  removal -- only `deleteRun`, which takes the whole run, its pages and its
  PDFs.
- **`CaptureLossError` is the third net, and it guards `slots` for the reason
  `PageLossError` guards `pages`.** `run.slots` STOPPED BEING DERIVABLE FROM
  THE TEMPLATE the day a lanjutan became something discovered rather than
  declared: `seedSlots` seeds one capture per fillable slot and a continuation
  is APPENDED when one is found, so a discovered capture exists only in the
  stored array. Any write rebuilt from `AO_TEMPLATE.sections` -- a migration, a
  "reset this run", a helper that maps over the sections -- therefore arrives
  at the correct revision, carrying every page, and simply short, and `putRun`
  would perform it and report success. Pages intact, revision current, a crop
  a human accepted gone. So a write that drops a stored slot state CARRYING A
  ZONE is refused unless it names the key in `putRun`'s `removing` option,
  which is what "Bukan ini" on a lanjutan passes (`withoutCapture` in
  `src/lib/browser/captures.ts` hands the keys back for exactly that call).
  Not an append-only rule: removal is legitimate, it just has to say so.
- **`SectionLossError` IS THE FOURTH NET, AND IT GUARDS A NAME RATHER THAN A
  PICTURE.** `putRun` runs four nets, not three. Once an order can add a judul,
  `run.overlay` carries something no template declares and no crop stands in
  for: a heading a person typed, or a usulan a person accepted, with a title
  that came off a scan in front of them. A write rebuilt from a fresh
  `emptyOverlay` -- a migration, a "reset this order", a helper that forgets to
  spread `added` -- arrives at the correct revision, carrying every page and
  every capture, and simply short one name. So a write that discards an
  AUTHORED node is refused unless it names the ids in `putRun`'s
  **`removingSections`** option, which is the section-level twin of `removing`.
  `discardedAuthorship` is the storage layer's OWN function, and every edit in
  `src/lib/browser/sections.ts` computes the opt-in by calling it rather than
  hand-listing ids: deriving the opt-in from the guard that will judge it is
  what makes it impossible for the two to disagree.
- **`overlay.proposed` IS NOT AUTHORSHIP.** A usulan nobody has ruled on costs
  a model call to make again, not a person's decision, so dropping one is
  allowed with no opt-in -- the same line `CaptureLossError` draws one level
  down between a capture carrying a zone and one that does not.
- **The tests use `fake-indexeddb`** (devDependency, test-only, never in the
  browser bundle): `node --test` has no IndexedDB, and a hand-rolled Map models
  neither the transaction nor the auto-commit that make the revision check
  mean anything. See `src/lib/browser/persistence.test.mts`.

### Matching two spellings (`src/lib/pipeline/abbrev.ts`)

- **`sameEntity`'s containment rule is fenced to NAME-LIKE values, and that
  fence is load-bearing.** Containment says "the shorter spelling is the longer
  one, abbreviated". `reconcileFieldValues` runs `sameEntity` over **every**
  fieldKey, so unfenced it declared `1-70000000001` and `1-70000000001-2` to be
  one quote and `Rp 5.000.000` and `Rp 5.000.000.000` to be one price -- and
  since `sameEntity` is what decides SETTLED versus CONFLICT, the losing number
  was recorded nowhere. `isNameLike` requires at least two identity-bearing
  words, none carrying a digit.
- **The cost is deliberate: street addresses are not name-like.** Two spellings
  of one address that differ in how much of the locality they print now come
  back as a conflict rather than being merged. A conflict blanks the cell and
  lists both spellings for the operator to settle in one edit; a fusion picks
  one silently. Fusing is the failure this project is organised against.
- **Equality, the domain-abbreviation table, and the acronym rule stay
  general** and are unaffected. They each demand that one side actually be
  written as an abbreviation before they will look at the other; containment
  demands nothing, which is why it alone is fenced.
- **Widening any of these means keeping the negative tests green.** The tests
  that matter in `scripts/test-pipeline.mjs` are the ones asserting `false`.

### Prompting and model replies

- **The prompt numbers pages BY POSITION in the listing, never by their true
  document index.** A pool starting at page 23 made the model answer 22: its
  chosen lines matched the intended page exactly, just under the wrong label,
  consistent with treating a non-zero first label as a 1-based ordinal to
  convert. Every other pool started at 0, where "convert to 0-based" and "echo
  the label back" produce the same answer, which is why it stayed hidden until
  the Surat Penunjukan pool. `buildLocatePrompt` and `extractFields` both
  renumber locally from 0 and map the reply back to `pages[i].index`. Do not
  "simplify" that by passing true indexes through.
- **Detect a transient error from the error OBJECT, not from `String(error)`.**
  A real Gemini 503 reads "This model is currently experiencing high demand.
  Spikes in demand are usually temporary." with no status code and no
  "unavailable" anywhere in `toString()`: the code lives on `statusCode` and
  `isRetryable`. A message-matching version of `isTransient` let a 503 kill a
  run that had already spent 100k tokens.
- **Cap thinking.** `thinkingLevel: "low"` in `src/lib/model.ts`. Thought
  tokens bill at the output rate and Gemini's own default is medium. An
  uncapped budget can spend the whole output allowance and return an empty
  message that reads like a bug in the app.
- **Pick the model by measurement, not by version number.**
  `gemini-3.7-flash` measured 99-190s on a trivial vision call with
  intermittent 503s, past the chat route's `maxDuration` of 120.
  `gemini-3.5-flash` answers the same probe in about 2s. Run `pnpm smoke`
  before moving the default in `src/lib/model.ts`.

### Exporters

- **`docx` `ImageRun` REQUIRES `type: "png"`.** Omitting it names the part
  `word/media/<hash>.undefined`, which has no content type, and Word refuses to
  open the file.
- **`docx`'s `transformation` is PIXELS AT 96 DPI, not points.** Crops are cut
  at 300 DPI, so converting to points renders every image at 75% of its true
  size, which looks plausible and is wrong. `toDocxPx` in `export/docx.ts` is
  the conversion.
- **Word does not shrink an oversized inline image to its column; it clips
  it.** The exporter caps width at the usable column derived from the sample's
  own `<w:sectPr>` and scales both dimensions together. Four of the fillable
  slots are whole-page captures in the SAMPLE, and every bagian under a judul
  an order adds or accepts is one, so an uncapped width is most of the
  document's visual content, not an edge case.
- **THE HEIGHT CAP IS `CAPTURE_HEIGHT_PX`, NOT THE USABLE HEIGHT, and a
  whole-page capture cannot test it.** The constructed path reserves
  `HEADING_BLOCK_TWIPS` above every capture so the judul and its picture share
  a page. For a portrait A4 page cut at 300 DPI the WIDTH cap binds first and
  the height cap never fires, so a test that feeds it a page-shaped crop passes
  whether the reservation is there or not. The test in
  `scripts/test-pipeline.mjs` feeds it 800x6000 for that reason.
- **THE CONSTRUCTED PATH'S TOP MARGIN IS 1080 TWIPS, NOT THE SAMPLE'S 873.**
  The banner occupies 504-950 twips down from the page edge. The sample clears
  it with two empty paragraphs in its own header, which pushes the body down by
  an amount only Word computes; this exporter has to know the usable height to
  size a capture against it, so the clearance is stated instead. Everything
  else in `<w:sectPr>` is still the sample's.
- **docx@9.7.1 BORDERS EVERY TABLE BY DEFAULT.** This file used to say the
  constructed path emits "no table borders"; measured on 2026-09-11, all seven
  tables come out with `single`/`sz=4` on all six edges whether asked or not.
  `TABLE_GRID_BORDERS` is passed anyway, as a pin against a release that flips
  the default, not because it changes a byte today.
- **A slot can hold more than one crop, and NOTHING DECLARES HOW MANY.** The
  sample's `KB (lanjutan)` ToP row stacks two pictures in one cell, and
  `SlotDef.crops` used to say so. An operator found what that produces: the
  sheet showed "ToP 1" and "ToP 2" with the second permanently missing, and
  there is only one ToP -- the two pictures are one payment clause split by a
  page break. A continuation is now DISCOVERED per document by
  `src/lib/pipeline/continuation.ts` (filter on geometry, confirm with one
  next-page call, loop for "more than 1 lanjutan"), and `SlotDef.crops` is
  dead. The exporter hazard is unchanged and is now the only reason the
  multiplicity survives at all: a `Map<string, FilledSlot>` keeps only the last
  crop and silently drops the other, shipping a document that looks complete
  and is missing evidence. `pnpm generate` runs the free detection half only
  and reports what it finds in `OUTSTANDING`; it never crops a continuation,
  because the extent call's measured error is a legible crop of the NEXT
  clause and a headless run has no operator to reject one.
- **An empty section still emits its heading, and an unfilled table row still
  emits its row.** `Konfigurasi (Excel dari EPIC)` and `Konfigurasi` ship as
  headings over empty rows the operator fills from EPIC, and a judul added but
  not yet captured ships as a bare heading. A deliberately empty cell is the
  deliverable. (A `<w:tbl>` with no `<w:tr>`, on the other hand, is
  schema-invalid and Word refuses the file.)
- **Use `Packer.toArrayBuffer`, not `toBuffer`.** `toBuffer` asks JSZip for a
  "nodebuffer", which throws in a browser with no `Buffer` polyfill, and this
  pipeline is meant to run in the browser.
- **Never add a spreadsheet library**, and note that Konfig Excel shipping
  `.xlsx` support did NOT relax this. Not `exceljs`, and not `xlsx` (SheetJS).
  See "THE PROGRAM NEVER AUTHORS A SPREADSHEET, AND NOW AMENDS ONE" above;
  SheetJS is additionally frozen on npm at 0.18.5 with two unpatched HIGH
  advisories whose fixes ship only from the vendor's CDN. `src/lib/xlsx/` is
  about 400 lines over `jszip` and does the only two things this product needs:
  read every cell with its address, and patch named cells inside bytes it did
  not author.
- **`patchWorkbook` VERIFIES ITSELF AFTER PATCHING, and that check is the module's
  whole point.** A cell-matching regex that misses does not fail; it appends a
  second `<row r="9">` holding a second `E9`, and Excel opens the result. So the
  writer re-scans what it produced and refuses unless every edited ref occurs
  exactly once holding exactly the intended value, with no duplicated row index.
  That defect was written, hit and fixed during the first spike of this feature;
  do not remove the check because the happy path passes without it.
- **A citation must name the source file and its own page number**, not this
  run's bundle-global page index. That global index is 0-based across every PDF
  on the command line, so for every page after the first source file it sent a
  reviewer to the wrong document. It last cost this project a wrong page
  reference in a cell note, and the two numbering systems are still one
  mistake apart everywhere they meet.

### Toolchain

- **Every relative VALUE import between `.ts` modules needs an explicit `.ts`
  extension.** Node 24 strips types without rewriting specifiers, so
  extensionless throws `ERR_MODULE_NOT_FOUND`, and `tsconfig.json` carries
  `allowImportingTsExtensions` for it. Type-only imports are erased and do not
  need it, which is why a few `import type` lines look inconsistent.
- **eslint must ignore both `public/tesseract` and `.claude`, recursively**
  (`globalIgnores` in `eslint.config.mjs` holds the exact globs).
  `public/tesseract` is regenerated build output written by `vendor:ocr`. Git
  worktrees live in-repo at `.claude/worktrees/<name>/` and carry their own
  `.next/` and `public/tesseract/`, which the root-anchored default globs do
  not match, so without that ignore `pnpm lint` reports another worktree's
  errors as this tree's.
- **`canvas: null` in `page.render()` is required, not cosmetic.** In
  pdfjs-dist 6.x `canvas` is a required `RenderParameters` property and the
  library honors `canvasContext` only when `canvas` is falsy. Omitting it fails
  `tsc`.
- **Never name a script `setup` in `package.json`.** `pnpm setup` is a reserved
  built-in that modifies the shell PATH; it silently shadows the package script
  and your code never runs.
- **`src/components/*` IS NO LONGER VENDORED.** It used to hold assistant-ui's
  generated thread components, which is why this file said not to hand-edit
  them. Those files are deleted; what is there now is `operator/` (this
  project's own screens, edit freely) and `ui/` (seven shadcn primitives, now
  styled from the same tokens as everything else). The `eslint.config.mjs`
  block that narrowed rules for five paths that no longer existed
  (`attachment.tsx`, `file.tsx`, `image.tsx`, `reasoning.tsx`, `thread.tsx`)
  **has been deleted**; `globalIgnores` is untouched and both of its globs are
  still load-bearing.
- **`createLocalStorageAdapter`'s history adapter lacks `withFormat`**, which
  `useChatRuntime` hard-requires and throws without. `src/lib/threads/history.ts`
  supplies one and `store.tsx` patches it in. Replacing that with the stock
  adapter compiles fine and silently stops persisting messages.
- **pdf.js must keep its bundled worker.** `GlobalWorkerOptions.workerSrc` is
  set from the installed package on purpose; the library's default fetches from
  a CDN.
- **The attachment `accept` list is load-bearing.** assistant-ui's composer
  filters on it before the adapter runs, so widening it re-introduces the
  original bug: files that attach fine and then fail after send with a bare
  "An error occurred."
- **The API key lives in `.env.local`, which is gitignored.** `.env.example` is
  the committed template, deliberately un-ignored by a `!.env.example` rule.
  Never put a real key in it.

## The operator UI

The material is **Meja Kaca, the glass bench**, and it is the THIRD one this
product has worn: the client rejected a monotone graphite as "monotonous" and
a hard-edged stamped look as "absolutely the wrong aesthetic". The argument
lives in `docs/design-system.md` and the language in `docs/ui-bahasa.md`; read
the first before you move a token and the second before you write a string.
What follows is only the part that bites.

**THE TOOL IS GLASS, THE WORK IS SOLID, and that seam is also the performance
rule.** Anything that STAYS STILL while work scrolls under it is glass:
translucent, backdrop-blurred, a bright hairline on the top edge (`.lt-rail`,
`.lt-toast`, `.lt-hint-panel`, the dialog). Anything that MOVES WITH THE WORK
is solid and matte: every slab, well, row, stage, mat, kotak and sheet. A
backdrop-filter inside the review sheet's metre-long scroll re-samples the
backdrop every frame across two dozen panels, so "glass never scrolls" is what
keeps the app cheap as well as what keeps the two materials meaningful.

**THE OPERATOR UI IS IN BAHASA INDONESIA.** Screen copy, labels, status words,
errors, empty states. Code, identifiers, comments, commit messages, this file
and the specs stay English. The operator-visible strings are NOT all in
`src/components/`: five refusal sentences live in `src/lib/auth/guard.ts`, four
sign-in errors in `src/app/signin/query.ts`, the allowlist's validation throws
in `src/lib/auth/allowlist.ts` (which `src/app/admin/actions.ts` classifies by
matching a **fragment** of, so rewording one means rewording both), the run-list
label in `src/lib/browser/runtime.ts`, and the 401 body in `src/proxy.ts`, which
hand-copies the guard's wording because it runs in a different runtime. A
components-only translation leaves half the product in English, and several
tests assert on these strings.

The packet's own names are NOT translations to invent: `BA Permintaan`, `KB
(lanjutan)`, `Jangka Waktu`, `TTD Pejabat`, `Nama Proyek` are transcribed from
the sample and must keep matching it.

**Four words the per-order section list added. The full glossary is
`docs/ui-bahasa.md`; these four are the ones a change is likeliest to get
wrong.**

- **judul** -- one heading of the DOKUMEN VALIDASI *together with everything
  filed beneath it*. NEVER "bagian", which is one cell needing evidence: `KB`
  is a judul and `Nomor` is a bagian inside it. The word was needed the day a
  section became something an order could rename, move, hide and add.
- **dibaca AI** -- the default for every berkas, and a berkas nobody has
  decided anything about wears it. Its key is petrol and never amber: no
  decision is owed there.
- **tanpa AI** -- the model may not propose out of this berkas. NEVER "gagal",
  "dilewati" or "tidak ditemukan". **The berkas IS still read**: every halaman
  is rendered, recognised, counted and drawn as a denah, and the operator can
  still cut a potongan out of it by hand and cite its baris. What stops is the
  model proposing. `--no-ai` is the same fence on the headless path.
- **belum digambar** -- a bagian under a judul the OPERATOR added. Nothing will
  ever search it (`isSearchable` is false for every bagian under an added
  judul), so it is not **tidak ditemukan**, which is fixed to mean SEARCHED AND
  NOT FOUND. Reporting it that way told the operator, on every reading pass for
  ever, that the tool had hunted for something nobody asked it about -- in the
  one place they go to decide whether to fetch another document. `pnpm
  generate`'s `MANUAL (n)` block is the same distinction in English.

**Two hues in the whole product.** `--mark` (amber) means "a decision is owed
here" and nothing else, ever. `--gap` (red) means a fault or a refusal and is
absent from a healthy screen. Confirmed work has NO colour, so a finished
packet is a screen with the colour gone out of it. `--petrol` is a third
colour and is NOT a status: it is identity and interaction (the primary key, a
link, the step you are standing on), deliberately off the amber-red axis so
"this is the button" cannot be read as "something is owed".

- **A SATURATED FILL ALWAYS CARRIES DARK TEXT.** This is the client's own
  complaint written as a rule: *"lots of clashing colors like bright yellow and
  white text"*. `--mark-ink`, `--gap-ink` and `--petrol-ink` exist for no other
  reason, and there is no exception for a colour that looks dark enough. A
  block that owes a decision turns as a whole through a 12% tint of its own
  ground plus a 4px rule down its leading edge, never a coloured bar.
- **Focus is ink, never amber.** A keyboard position is not a decision owed.
- **`.lt-paper` rebinds the ink tokens, and that is load-bearing.** Every token
  is defined against the dark bench, so on a white sheet `--ink` is invisible:
  the global `:focus-visible` rule once drew a near-white outline on paper at
  about 1.08:1, on the sign-in button among others. The rebind covers
  `.lt-paper`, `.lt-denah` AND `*:has(> .lt-denah)`; that third selector is
  there because `denah.tsx` puts its "teks tidak terbaca" caption in a SIBLING
  of the svg, so a rebind scoped to the svg never reached it.
- **PREFIXED FIRST, STANDARD LAST, for `backdrop-filter`.** Written the other
  way round, Lightning CSS collapses the pair and emits only
  `-webkit-backdrop-filter`; Chrome has no such alias, so every piece of glass
  renders with no blur while looking entirely deliberate.
- **Chrome glass is `--glass-rail` at 90%, not `--glass` at 8.5%.** A panel
  floats over the gradient and nothing else. Chrome floats over whatever is
  scrolling, which on the review sheet is a white A4 scan: at 8.5% the phase
  rail composited to about #ebeeef and its own text measured 1.1:1 until the
  page passed.
- **Nothing in the product is under 13px**, because every small string here is
  safety copy. Quietness is bought with size and position, never with lower
  contrast.
- **Uppercase is reserved for quoting the document.** The interface never puts
  a label in caps to give it rank. Positive letter-spacing appears in exactly
  two rules, the wordmark and `.lt-stamp`, both quotations.
- **Every ratio in `globals.css` is measured against the composite that
  actually paints**, never against a token: glass over the rasterised lightest
  pixel of the gradient, a stripe at its own alpha, a nested panel as two
  films. Three independent verification passes each caught the same error, a
  comment quoting the ratio of the colour its author wished were behind the
  text.

**The denah halaman** (`denah.tsx`) is the hero device: a plan of the page drawn
from `StoredPage.lines[].box`, with the crop knocked out. It answers "is this
the right page" with a picture rather than a better-typeset number, and it is
free (no bitmap, no blob, no network). **A page whose OCR returned nothing must
never render as an empty sheet** -- that would be a new wrong-and-quiet surface
built by the thing meant to close one -- so it draws an outline with a struck
rule, and a never-searched capture draws a third, different silhouette.

**The paraf finishes when the write does.** `Mark`/`Paraf` take `drawing` and
`saved`; the stroke sits at 40% opacity until `saveRun` resolves. This codebase
already refuses stale and page-losing writes and the operator previously had no
signal that a decision reached disk.

**The flow is FOUR steps**: `1 Berkas Order`, `2 Checkpoint`, `3 Konfig Excel`,
`4 Input EPIC`. The names are the client's, given 2026-09-10 after a one-day
detour through "Checkpoint 1/2/3", and they are proper nouns for stages of their
process: do not translate them, and do not number them.

- **`1 Berkas Order` is Muat and Periksa on ONE page.** The upload section is
  drawn first; the whole lembar periksa is drawn below it once the reading pass
  has run, with both halves exactly the components they were (`IngestPanel`
  above, `ContactSheet` below). `hasBeenSearched` is the gate that used to lock
  Periksa, so the review appears at the moment that step used to open. The
  upload section stays above it, because a dokumen tambahan is part of
  reviewing. **There is no `ingest` phase id any more, deliberately:** a
  leftover `phase === "ingest"` is a compile error rather than a dead branch.
  Jumps that used to be phase changes ("Tambah dokumen", "Kembali ke lembar
  periksa") are now SCROLLS to a section of the one page, measured against the
  sticky strip with the same `stickyHeader()` the contact sheet uses. An order
  already read still opens at its review, which is what `landingPhase`'s
  "mid-flow if it can be" became. The tambahan loop is still the head of the
  lembar periksa, and an ingest fault is printed once, in the upload section,
  never also beside the sheet.
- **`2 Checkpoint`** is the old `Berkas`. What it does did not change: it builds
  and hands over the DOKUMEN VALIDASI.
- **`3 Konfig Excel`** takes the operator's EPIC order-configuration workbook,
  checks every isian in it against the scans, and hands back THEIR OWN FILE with
  the cells they approved amended. See "THE PROGRAM NEVER AUTHORS A
  SPREADSHEET" above before touching any of it.
- **`4 Input EPIC`** takes screen captures of EPIC itself and checks them
  against that workbook, and produces a ringkasan rather than a file.

**NEITHER KONFIG EXCEL NOR INPUT EPIC IS IN `pnpm generate`, DELIBERATELY**, and this follows
the precedent this file already records twice. Discovery ships the detection
half only and continuations are found but never cropped, both because a headless
run has NO OPERATOR TO REJECT ANYTHING. Konfig Excel is nothing but a queue of
recommendations a person approves or rejects one at a time, so a headless
version of it would either write an unreviewed workbook -- amending the
operator's own file from a model's answer, silently -- or write nothing and only
look like a feature. If a bulk path is ever wanted, the shape to copy is
`--discover-sections`: emit a file of PROPOSALS that a human edits and feeds
back, never a deliverable.

**The phases are drawn as a TIMELINE, not as buttons**, and the
difference is a fact rather than a style. Keys side by side say these are
things, equally available, pick one; they are not. They are one route
with an order, a position on it, and a gate part way along. `.lt-timeline` is a
node per phase with a rail between them that fills behind you, which is the
progress three separate buttons could not show. A reachable phase is still a
button and still navigates; a locked one is `aria-disabled` (never `disabled`,
so a keyboard can still reach it and hear why).

**A DISABLED CONTROL'S REASON RIDES ON THE CONTROL.** `Btn` takes `reason` and,
while it is actually disabled, wraps itself so the sentence reaches a pointer,
a keyboard focus and a screen reader. It replaced a paragraph printed beside
the key, which an operator called redundant: the key is down, that already
reads as unavailable. THE RULE DID NOT CHANGE, ONLY THE PLACE. A refusal, a
fault, or anything the operator must act on still belongs on the page in prose,
because the test is whether they may miss it entirely and be no worse off.

**THE OPERATOR IS NOT THE AUDIENCE FOR OUR ENGINEERING.** Recorded because half
a redesign's worth of copy had to be deleted to learn it: no screen tells them
that pages are rendered in the browser, that text is sent to a server, how many
pages of text that was, or that we are compliant. That belongs in
`/privacy`, and the sentences were removed from the flow ON THAT PAGE'S CREDIT,
so it has to keep carrying them. What stays on screen is what is happening in
the operator's terms and what they can do about it. The three standing
exceptions are the deployment band about running with no account check (a live
security condition), any refusal or fault, and the export-blocked sentence.

**Fonts are Atkinson Hyperlegible Next and Mono**, self-hosted by `next/font`,
which is what keeps `performance.getEntriesByType("resource")` showing only this
origin. `adjustFontFallback: false` is deliberate and commented: Next has no
metrics for these families, and the alternative was a permanent build warning.
The mono is the DOCUMENT's voice (section and field names, page and line
numbers, sizes, identifiers), the sans is the app's; using mono to make a small
label look technical is the habit that was removed.

## What a request costs

Measured against `gemini-3.5-flash`. **These per-image numbers apply to
every image path, INCLUDING the validator pipeline: since the Gemini OCR
migration each page of a run is one image call, so multiply the per-image row
by the bundle's page count (29 for the sample) before quoting a run cost.**

| `mediaResolution` | prompt tokens / image | | `thinkingLevel` | thought tokens |
|---|---|---|---|---|
| `MEDIA_RESOLUTION_LOW` | 274 | | `minimal` | 0 |
| `MEDIA_RESOLUTION_MEDIUM` | 528 | | `low` (default here) | ~40-100 |
| `MEDIA_RESOLUTION_HIGH` (default) | 1110 | | `medium` (Gemini default) | ~194 |
| | | | `high` | ~324 |

Image tokens are a flat rate per tier, not per pixel: a 224x224 thumbnail and a
1700x2200 page both bill ~1110 at HIGH. Downscaling saves upload and IndexedDB
space but not a single API token, and attaching several small images is far
more expensive than it looks. `DEFAULT_PAGE_LIMIT` in
`src/lib/attachments/pdf.ts` is a cost cap on the chat route, not a context
cap.

`MEDIA_RESOLUTION_HIGH` stays the default because anything that does send an
image here is sending a dense scan, and `MEDIUM` halves the input cost by
discarding exactly the detail that decides a verdict. Change it only with
accuracy measured on real scans. **It is a ~4% lever, not the largest one;**
the paragraph that said otherwise is corrected under "ONLY THE OCR STAGE SENDS
IMAGES" above.

### What a whole bundle costs, measured per stage

Run `pnpm generate` and read its cost table rather than trusting this one. As
of 2026-09-03 on the 29-page sample bundle, prices per million tokens
`gemini-3.5-flash` $1.50/$9.00 and `gemini-3.8-flash` $0.75/$3.75:

| stage | calls | in | out | before | after |
| --- | --- | --- | --- | --- | --- |
| OCR (images, 1/page) | 29 | 35.4k | **57.6k** | $0.5715 | **$0.2426** |
| locate | 7 | 160.7k | 3.9k | $0.2759 | $0.2759 |
| extract | 2 | 46.1k | 665 | $0.0751 | $0.0751 |
| verify (crops) | 3 | 3.4k | 1.6k | $0.0200 | $0.0200 |
| classify | 2 | 3.5k | 965 | $0.0139 | $0.0139 |
| **total** | **43** | **249.1k** | **64.7k** | **$0.9564** | **$0.6274** |

"After" is the shipped configuration and is a real run's printed table, not
arithmetic: OCR on `gemini-3.8-flash`, the reasoning stages on
`gemini-3.5-flash`. **Rp 10,353 a bundle at 16,500/USD, down from Rp 15,780,
a 34% cut** with the gate equal-or-better (11/10/11 against 11/9/11).

Note where the money actually is, because it is not where this file used to
say: **OCR's 57.6k OUTPUT tokens** are the single largest quantity in the run,
and `locate`'s **160.7k INPUT tokens** the second. Image input is 35.4k of
249k.

**The remaining big line is `locate`'s 162k input tokens**, which is one 23k
page listing sent seven times because all seven fillable slots share one pool.
Two ways to stop that were measured and one is untried:

- **Prefix caching WORKS and was REVERTED.** Reordering the prompt so the
  listing leads earns Gemini's ~90% prefix discount on 122k tokens a run
  (`cached=20393` on six of seven calls), taking locate to $0.11 and the whole
  run to $0.22 excluding OCR. It also turns `KB / Nomor` from an intermittent
  failure into a certain one, in every arrangement tried. See the measurement
  table in `src/lib/pipeline/locate.ts`'s header before trying it again.
- **Consolidating the pool into one call is the untried option**, and the
  measurements point at it: it saves more than caching did and keeps the
  question BEFORE the listing, which is the ordering that matters. It is a
  restructure, not a reordering; the same header says what it costs.

**The Batch API is not applicable to this product and no code was written for
it.** It is a flat 50% off, and it returns results within 24 hours. The
operator path cannot use it -- pressing Proses and receiving the packet
tomorrow is a different product -- and the two scripts have no operator to wait
but do have a developer, for whom `GENERATE_CACHE_MODEL=1` is strictly better
than half price a day later. Revisit only if a genuine unattended bulk queue
ever exists.

The levers, all env-tunable so a deployment can trade accuracy for cost
without editing code: **`OCR_MODEL_ID`** (the largest, and the one with a
measurement behind it), `GEMINI_MEDIA_RESOLUTION` (~4%; images only),
`GEMINI_THINKING_LEVEL` (applies everywhere; `low` is the cheap win against
Gemini's default of medium with no measured loss on field extraction), and
`GEMINI_MAX_OUTPUT_TOKENS` (a runaway guard, not a budget: the model will
otherwise emit up to 65536, and a reply cut short logs a warning naming the
variable).

## The client constraint, as it now stands

The original rule was third-party minimization: the data must not leave the
machine. Two approvals have narrowed it, and neither is a general licence.

- **Google is an approved processor for inference** (2026-08-28), which is what
  moved inference to the Gemini API.
- **Hosting on Google Cloud is approved** (2026-08-31), not only inference.
  That question was open in the 2026-08-30 design and is now closed.

What did not change:

- **Documents still stay on the device.** Sessions persist to IndexedDB and
  every document conversion, render, and OCR runs locally. Neither was
  re-opened, so don't "simplify" either one toward a hosted service, and there
  is deliberately no Cloud Storage bucket.
- **The browser still talks to nothing but this app.** With the page open,
  `performance.getEntriesByType("resource")` should show zero external hosts.
  The self-hosted pdf.js worker and the vendored tesseract assets are what keep
  that true; a CDN fallback in either breaks it silently.
- **The key is server-side only.** It is read in `src/lib/model.ts`, which only
  `/api/chat` and `scripts/generate.mjs` import (`smoke.mjs` and
  `measure-locate.mjs` read the env var themselves), and it has no
  `NEXT_PUBLIC_` prefix, so it cannot reach the browser bundle. Keep it that
  way.
- **Real client documents still never get committed.** `/documents`,
  `/documents/new` and `/test-docs` stay gitignored; you may read them, never
  stage them. This repo is public, and Google being an approved processor did
  not make the client's files publishable. **Never put a real LOP number, quote
  number, SID, customer name, project name, address, price, phone number or
  email address in a committed file** -- not in a test fixture, and not in a
  doc comment's example either, which is where the last one got through.

  The fictional set used throughout the tests and this document:

  | Kind | Use |
  | --- | --- |
  | LOP number | `LOP999001` |
  | Quote number | `1-70000000001` |
  | Customer | `BANK CONTOH NUSANTARA` |
  | Project | `PSB VPN IP KCP Contoh` |
  | SID | `1209990001` |
  | Contact | `Budi Contoh`, `budi@contoh.example` |

  **The list is a tool, not a decoration: extend it the moment a new KIND of
  identifier appears.** `SID` is here because the second bundle introduced
  per-service rows and there was no fictional SID to reach for, so a real one
  went into a doc-comment example and reached a public repo.
  A writer with nothing to substitute substitutes what is in front of them.

## Where things live

`src/lib/model.ts` is the only file that knows how the model is reached. It
owns the model id, the cost settings, and the credential. Everything upstream
receives an AI SDK `LanguageModel`, or an injected
`Ask = (prompt: string) => Promise<string>`, and knows nothing about who serves
it. Keep provider SDK imports out of app code, out of `src/lib/pipeline/`, and
out of the scripts.

The model is built lazily, on first request rather than at import time. A
missing key would otherwise throw while Next collects routes and fail the build
instead of the request that actually needs the credential.

```
src/lib/model.ts               the provider boundary: model ids, cost, credential
                               MODEL_ID reasons, OCR_MODEL_ID reads scans
src/lib/cost.ts                the price table and the per-stage cost ledger
src/lib/forms/template.ts      AO_TEMPLATE: docx section list + field row
                               list. FOUR JUDUL, and only KB is searched;
                               SlotAsk is the frozen half a prompt sees
src/lib/forms/overlay.ts       TemplateOverlay: one order's diff against that
                               base, assertOverlay (the fence), resolveTemplate
src/lib/pipeline/render.ts     pdf.js, /Rotate, 300 DPI, injected canvas
src/lib/pipeline/vision-ocr.ts Cloud Vision words -> this pipeline's lines
src/lib/pipeline/gemini-ocr.ts the page-completeness guard, and the Gemini
                               vision engine behind OCR_ENGINE=gemini
src/lib/pipeline/geometry.ts   words -> numbered lines, union, pad, line range -> box
src/lib/pipeline/classify.ts   doc-type spans from OCR text
src/lib/pipeline/sections.ts   what judul does this berkas contain (usulan only,
                               text-only, no gate row)
src/lib/pipeline/locate.ts     slot -> line range -> box
src/lib/pipeline/fields.ts     header values with validated citations; reconcile
src/lib/pipeline/abbrev.ts     do two spellings denote one thing (see gotchas)
src/lib/pipeline/json.ts       the one extractJson every model reply goes through
src/lib/pipeline/config-interpret.ts  what isian does this workbook hold; every
                               cited address checked against the real grid
src/lib/pipeline/config-compare.ts    Konfig Excel: does each isian agree with
                               the scans (one call carries every field)
src/lib/pipeline/epic-compare.ts      Input EPIC: does EPIC agree with the
                               workbook. THE YARDSTICK IS THE OTHER WAY ROUND
src/lib/export/png.ts          dependency-free PNG encoder
src/lib/export/crop.ts         sub-rectangle out of a rendered page
src/lib/export/docx.ts         the DOKUMEN VALIDASI packet, the one output

src/lib/xlsx/grid.ts           A1 addresses and the cells one sheet holds
src/lib/xlsx/read.ts           OOXML -> that grid, over jszip. NO SPREADSHEET
                               LIBRARY, and none may be added
src/lib/xlsx/write.ts          named cells patched inside the operator's OWN
                               bytes, and VERIFIED after patching
src/lib/xlsx/listing.ts        the sheet as the text a model reads, addresses
                               and all: buildLocatePrompt's device, for cells
src/lib/config/types.ts        Konfig Excel and Input EPIC as data; the contract
src/lib/config/effective.ts    decisions -> the cells the download writes
src/lib/config/difference.ts   WHERE two spellings of one isian diverge and WHAT
                               KIND of divergence it is. It EXPLAINS, it never
                               suppresses: a `beda` whose kind is `spasi` is
                               still `beda` and still owed a decision

src/lib/browser/runtime.ts     THE browser-runtime surface; everything else
                               under browser/ is private to it
src/lib/browser/types.ts       BrowserRun, StoredPage, SlotState (+ rev),
                               RunSource.ai (dibaca AI / tanpa AI),
                               konfigurasi + epic (both REQUIRED, see the file)
src/lib/browser/sections.ts    one operator gesture on the judul list, as a value
src/lib/browser/config.ts      one operator gesture on the konfigurasi, as a
                               value; each computes its own putRun opt-in
src/lib/browser/ingest.ts      the render+OCR page loop, dependencies injected
src/lib/browser/intake.ts      what counts as the same document, and the
                               screening a hand-over goes through
src/lib/browser/pipeline.worker.ts  that loop, in a Web Worker
src/lib/browser/worker-client.ts    the page's side of it
src/lib/storage/runs.ts        IndexedDB: runs, pages, PDF bytes; the rev check
                               and the FOUR loss nets (pages, captures, judul,
                               decisions). The count in this line has been wrong
                               once already; check `putRun` before quoting it
src/lib/storage/indexeddb.ts   the chat scaffolding's separate key/value DB

src/app/globals.css            THE DESIGN SYSTEM: tokens, materials, marks
docs/design-system.md          the argument for it; read before moving a token
docs/ui-bahasa.md              the operator UI's language and its glossary
src/components/operator/chrome.tsx  Mark, Paraf, Cite, Advisory, Interruption
src/components/operator/denah.tsx   the page plan, with the crop knocked out

src/lib/ui/runtime.ts          a MIRROR of the runtime contract, not an import
src/lib/ui/stub-runtime.ts     a fake runtime that invents scans (see below)
src/lib/ui/slots.ts, evidence.ts, export.ts, snap.ts, crops.ts
                               the operator screens' logic, UI-free
src/components/operator/       the operator screens themselves
src/lib/auth/                  Auth.js, the Firestore allowlist, the gates

scripts/generate.mjs           pnpm generate: the whole pipeline, one command.
                               --sections applies an overlay, --no-ai fences a
                               berkas, --discover-sections detects and never
                               crops
scripts/measure-locate.mjs     pnpm measure:locate: the gate, real documents,
                               the BASE form only and never an overlay
scripts/smoke.mjs              pnpm smoke: reachability, text, streaming, vision, cost
scripts/reply-cache.mjs        opt-in on-disk model-reply cache, scripts only
scripts/compare-ocr.mjs        diff two gate transcripts' per-page OCR tables
scripts/probe-completeness.mjs pnpm probe:pages: every page of one PDF through
                               the real render + Vision + completeness check,
                               reporting EVERY page that would stop an ingest
                               rather than only the first one the app can see
scripts/probe-sections.mjs     pnpm probe:sections: discovery over a whole
                               bundle, every span with its cited title lines
                               printed for a person to READ. It stands in for
                               the gate row discovery does not have
scripts/test-pipeline.mjs      the pipeline unit suite
scripts/test-converters.mjs    docx text extraction

src/app/page.tsx               the operator UI, behind the auth gate
src/app/api/chat/              the surviving chat route (no caller in this app)
docs/runbook-deploy.md         deployment, which has its own doc
```

`pnpm smoke` asserts reachability, text, streaming, vision, and per-page image
cost with no UI involved. Run it before debugging the browser; it tells you
which side of the boundary is broken. It calls the same native Gemini REST
surface `@ai-sdk/google` uses, with the same settings `src/lib/model.ts` sends.
Driving the OpenAI compatibility endpoint instead would be less code and would
pass while the app was failing, because the shim carries neither
`thinkingConfig` nor `mediaResolution`.

`pnpm test` runs six suites with `node --test` and makes no API calls:
`scripts/test-converters.mjs`, `scripts/test-pipeline.mjs`, and the four
alongside the code they cover -- `src/lib/auth/auth.test.mts`,
`src/lib/browser/browser.test.mts`, `src/lib/browser/persistence.test.mts`
(IndexedDB, via `fake-indexeddb`) and `src/lib/ui/ui.test.mts`. `pretest` runs
`pnpm vendor:ocr` first; see the OCR gotchas for why that is not optional.

## Not built yet, and known gaps

Recorded so nobody reads a design statement as a description of the code.

- **JUDUL DISCOVERY EXISTS AND SHIPS WITH NO GATE ROW. Said plainly, because a
  stage with no number attracts one.** `src/lib/pipeline/sections.ts` asks one
  document at a time what judul it contains, text-only, `Ask = (prompt) =>
  Promise<string>` like `classify.ts`, so "classify, locate and extract are
  provably text-only" extends to it unchanged. Every entry is checked and never
  trusted -- a reversed span, a page the berkas does not have, a lineless first
  page, two spans claiming one page, and above all **a title that is not a
  substring of the lines it cites** all land in `unusable` with a reason
  instead of reaching a person. An invented heading is a fabricated section
  title in a document a validator signs, and nothing downstream could catch
  one.

  **There is deliberately no gate number for it**, and there is no honest way
  to produce one today: three runs of an identical LOCATE prompt scored 11, 9
  and 11, so a one-run total for a brand new stage would be a measurement error
  dressed as evidence, and there is no human-authored ground truth for "what
  judul does this bundle contain" -- the two sample packets are one person's
  answer for one order each. What it has instead is that **every judul and
  every potongan is accepted individually by a person**, and
  **`pnpm probe:sections`**, which runs discovery over a whole bundle and
  prints every span with its page range and its cited title lines for a human
  to READ. Do not quote a count from one run of that as a result either; its
  own header says so.
- **There is no vision fallback for signature blocks. It is DESIGNED, NOT
  BUILT.** The 2026-08-30 design specifies sending the page image alongside the
  numbered lines for `TTD Pejabat`, a signature and stamp block with little OCR
  text to anchor to. Nothing implements it: `locate.ts` takes no image
  parameter, and `Ask` is typed `(prompt: string) => Promise<string>`, so
  there is nowhere for an image to go. The gate scores all twelve slots
  text-only. Never describe it as the current path.
  (**And do not reach for it to close a gate miss.** The tesseract run's one
  miss was `KB / ToP (2)`, a different slot from `TTD Pejabat` and text-heavy,
  and the Gemini run has no miss at all -- so `TTD Pejabat` passes text-only on
  both engines and there is currently no measurement asking for this.)
- **THE OPERATOR UI IS WIRED TO THE REAL RUNTIME. This bullet used to say the
  opposite and it was believed for too long.** `operator-app.tsx` holds
  `const runtime = liveRuntime;`, and `src/lib/ui/live-runtime.ts` binds that
  to `import * as browserRuntime from "../browser/runtime.ts"`. The stub still
  exists at `src/lib/ui/stub-runtime.ts` but nothing shipped imports it, and it
  refuses to construct in a production build.

  **Do not re-derive the old warning from the file's existence.**
  `src/lib/ui/wiring.test.mts` pins all three facts -- that `liveRuntime` is
  identical to the browser runtime function by function, that the operator app
  imports it and not the stub, and that the stub throws in production. The app
  ran on `createStubRuntime()` for an entire track and nothing failed, which is
  why the binding is now a value a test can assert on rather than a line in a
  `.tsx` no test could import.
- **The two tracks ARE snapped together.** `src/lib/ui/runtime.ts` re-exports
  the contract from `../browser/runtime.ts` instead of hand-copying it, so a
  signature that drifts is a `tsc` error rather than a runtime
  `undefined is not a function` in front of an operator. The drift the old
  bullet warned about is resolved: `BrowserRun` carries `rev`, `saveRun`
  returns the stored run, and the UI's `commit()` keeps what it returns.
- **The browser DOES propose zones, through `/api/propose`.** The old bullet
  said no such route existed and named `/api/locate`, which was never built.
  `src/app/api/propose/` is: `src/lib/ui/propose.ts` posts the run's numbered
  OCR lines to it, and `applyProposals` folds the answer back into the run. The
  boundary rule is intact -- the route runs server-side and is the only place
  the model is reached, so `src/lib/model.ts` stays the one file that knows how.

  Verified against the deployed service on 2026-09-02: a request naming
  `kb.nomor` returned a zone whose box was the union of the answered line range
  padded by `CROP_PADDING_PX`, and a slot it could not find came back in
  `outstanding` rather than as an invented zone.
- **`/api/extract` HAS A CLIENT NOW, and the years it did not are worth
  recording.** The route was built, tested and gated, and NOTHING IN THE APP
  CALLED IT: the browser's only fetch sites were `propose.ts` and the ingest
  worker. The consequence was invisible and total: the docx header table sat
  blank BY CONSTRUCTION, for every run, whatever the documents said, and it
  read to an operator exactly like extraction failing.

  `src/lib/ui/extract.ts` is the wire. The export screen reads once per order
  (the shell holds the answer so a phase switch does not re-bill a 29-page
  call), fills only fields that are genuinely EMPTY, and never overwrites a
  filename-derived guess or an operator's typing.

  **THE HEADER TABLE IS NOW THE ONLY THING EXTRACTION FEEDS**, since the
  workbook went. Of the four declared keys, `namaProyek` (blocked by
  `NEVER_EXTRACTED`) and `cc` reach it; `picContacts` and `alamat` are still
  asked for and reach nothing. That is a known, accepted cost of keeping the
  question unchanged rather than an oversight -- narrowing it is a prompt
  change, and a prompt change is a thing only the measurement gate may judge.

  **A blank value is never written, whatever its status.** A field can arrive
  empty under a status that is not a failure -- `not-searched` for the key
  nothing searches, and `conflict`, which ships blank on purpose with both
  spellings recorded. `fillableValues` drops every blank for that reason and
  `ui.test.mts` pins it.

  **A cited field is told WHERE to look and is not told to be careful.** The
  citation is the check and a better one than a warning. What a validated
  citation is NOT is proof the value is right: `namaProyek`'s recorded failure
  was a citation that PASSED validation, which is why `confidence` is capped
  per key independently of it.

- **`pnpm generate` writes its two output files unreviewed.** The design's
  "the app never emits an unreviewed zone" describes the UI's target, not this
  command. `--discover-sections` writes a third,
  `<ID EPIC>_SECTIONS.json`, and it is the one file here that is NOT a
  deliverable: everything in it sits in `proposed`, which `resolveTemplate`
  never reads, so it is an INPUT to a human and then to the next run. That is
  the shape every model answer would have to take before this command could be
  trusted to emit one.
- **The "dokumen tambahan" loop is built twice, in two places, and neither is
  complete.** In `generate.mjs`: it searches every supplied document for every
  slot, reports the outstanding ones by name and reason in an `OUTSTANDING (n)`
  log block and an `<ID EPIC>_OUTSTANDING.json` report, accepts further
  documents through `--tambahan <file.pdf>`, and re-searches only the
  outstanding slots while keeping earlier zones (`searchRound`, `mergeZones`);
  the loop is the operator re-running the command. In the UI:
  `outstanding-panel.tsx` asks the question and `zone-editor.tsx` is the manual
  zone selection the design calls the terminal state. Both are real code on the
  real runtime. As of the UI rehaul the panel is no longer a phase of its own:
  it is rendered as the `head` of the review sheet, and answering "yes" opens
  the ingest drop in a dialog.
- **`docker build` READS THE WORKING TREE, so a shared checkout can ship work
  that is on no branch.** The tag comes from `git rev-parse HEAD` and the
  CONTENTS come from disk, so any uncommitted change rides along inside an
  image labelled with a commit that does not contain it. On 2026-09-03 three
  sessions shared this working directory and two Cloud Run revisions shipped a
  third session's in-progress work; it was inert only because the change
  defaulted off. Build from a throwaway `git worktree` at the commit you mean
  to ship, which is clean by construction. `docs/runbook-deploy.md` step 1
  carries the recipe and the refuse-if-dirty guard.

  The same class of error produces wrong NUMBERS, not just wrong images: a test
  count, a gate result or a contrast measurement taken against a state nobody
  named is wrong in a way that reads as fine. "502 tests" on that polluted tree
  was 487 on `main`.

- **Deployment is built, and its own doc is `docs/runbook-deploy.md`.**
  `Dockerfile`, `output: "standalone"` in `next.config.ts`, `src/proxy.ts`,
  Auth.js under `src/lib/auth/`, and the Firestore allowlist all exist. This
  bullet used to claim none of them did; check the tree before repeating it.
- **`measure-locate.mjs` does not go through `src/lib/model.ts`.** It calls the
  Gemini REST surface with plain `fetch` (no provider SDK, so the boundary rule
  is not broken) and reads its own env defaults, which is how the harness was
  written on a branch that predated the Gemini migration. The consequence to
  know: the gate can pass while `src/lib/model.ts` is broken, and its own
  defaults can drift from the app's. Check both before reading a gate result as
  a statement about the app.
- **The `typeof window` worker blocker is FIXED, and the mechanism this file
  used to record for it was wrong.** Worth keeping the correction, because the
  wrong version is the kind that gets re-derived.

  The old note said: `ocr.ts` reads `typeof window === "undefined"` as "in
  Node", which is false in a Web Worker, so the vendored asset paths are
  skipped there and tesseract.js falls back to its CDN. **That last step does
  not follow.** Read back out of the emitted worker chunk, Turbopack
  CONSTANT-FOLDS that condition to false for a browser target and inlines the
  browser branch, so the vendored paths were passed anyway and no CDN fetch
  ever happened. The old code was correct *by bundler behaviour* rather than by
  construction -- true only while whatever builds this keeps folding it, and
  silently a third party in the browser's request path the moment it does not.
  That is a real defect, and a different one from the one that was written
  down.

  **The defect that genuinely broke a worker, under any bundler, was the SHAPE
  of the asset paths.** tesseract.js resolves a relative path to an absolute
  URL only when its own environment is `'browser'`; inside a worker it is
  `'webworker'` and that resolution is SKIPPED, so the raw string travels on to
  a Blob-URL worker whose whole body is `importScripts("<path>")`. A `blob:`
  URL has an opaque path, and a root-relative specifier cannot be resolved
  against one at all.

  Both are fixed. `detectRuntime()` detects a browser POSITIVELY (a `document`,
  or a worker's `importScripts`/`WorkerGlobalScope`), falls back to `"browser"`
  for an unknown runtime so an unrecognised environment 404s loudly rather than
  reaching a CDN, and takes its scope as an argument so a test can hand it a
  synthetic worker. `vendoredAssets()` emits ABSOLUTE URLs off
  `location.origin`, falling back to a relative path only for an opaque origin,
  where `"null/tesseract/..."` would be worse. `src/lib/export/png.ts` carried
  the same `typeof window` pattern and is fixed too.
  `src/lib/browser/browser.test.mts` pins all of it.
- Only two sample bundles exist. That is enough to test capture and not enough
  to claim accuracy.
