# DOKUMEN VALIDASI generator: design

Date: 2026-08-30
Status: approved, ready for implementation planning

## Goal

Turn a bundle of scanned order documents into two artifacts:

1. **`Form_Validasi_<LOP>_<QUOTE>.docx`**, the DOKUMEN VALIDASI evidence packet.
   For each checklist slot it holds a cropped picture of the region of the source
   document that proves that slot, in the manner of a screen capture rather than
   a text quote.
2. **`<LOP>_ORDER_Config_<...>.xlsx`**, the EPIC order-entry script, with values
   filled in where a source document backs them.

A human confirms or corrects every proposed region before either file is
written. The app never emits an unreviewed zone.

This replaces the assistant-ui chat scaffolding, which existed only to prove the
inference path and has served that purpose.

## What the sample documents actually contain

Findings from `documents/`, established by inspection on 2026-08-30. These
correct several assumptions that a reading of the file names alone would
suggest.

### The output docx is a reused template

`Form_Validasi_LOP285120_1-72989090591-bsivpn (2).docx` reports
`dc:title = DOKUMEN VALIDASI`, `dc:creator = Maries Swendy`, `cp:revision = 256`,
created 2025-05-07. It is a form that gets filled per order, not a layout
invented for this order. Its skeleton:

| Section | Rows | State in sample |
| --- | --- | --- |
| Header table | ID EPIC, Nama Proyek, QUOTE, CC, ORDER, Jenis Order | text only |
| BA Permintaan | one image | filled |
| SP | two images | filled |
| KB | Nomor, Para Pihak, Tanggal, Jangka Waktu | filled |
| KB continued | Detail, ToP, TTD Pejabat | filled |
| Konfigurasi (Excel dari EPIC) | SID, Konfigurasi | one image |
| Konfigurasi | 1-72989090591, Price & SA, BW, BA | filled |
| Email | one image | filled |
| MOM | none | empty |
| BA Splitting | Nomor, Detail Kontrak, Detail Splitting, TTD Pejabat | empty |
| SBR Pricing | Nomor dan tanggal, Diskon ke CC, TTD Pejabat | empty |
| BASO | none | empty |
| BA Penjelasan Order | none | empty |

Sections shipping empty is normal, not a defect. The generated document must
preserve empty sections so the operator can fill them by hand later.

### Provenance of all seventeen images

| Images | Source |
| --- | --- |
| 1 (BA Permintaan) | `SPLITBA...pdf` page 1, Berita Acara Permintaan Order |
| 2, 3 (SP) | `...merged.pdf` pages 24 to 27, Surat Penunjukan |
| 4 to 11 (KB, seven slots) | `...merged.pdf` pages 1 to 23, Perjanjian Kerjasama |
| 17 (Email) | `SPLITBA...pdf` page 2, Outlook message |
| 12 (Konfigurasi Excel) | a screenshot of the order config xlsx itself |
| 13 to 16 (Konfigurasi) | screenshots of the EPIC web app at `http://10.192.30.26:8080/web`, with red rectangles drawn by hand |

Eleven of seventeen come from the two PDFs. Six cannot, because their sources
are a web application and a spreadsheet the operator has open elsewhere.

### The sources are pure scans, rotated

Every page of `...merged.pdf` (27 pages) and page 1 of `SPLITBA...pdf` carries
zero text items under pdf.js. Each page holds one `paintImageXObject` of
3507x2480 pixels on an 841.68x595.2pt landscape MediaBox, which is about
300 DPI. Every such page sets `/Rotate 270`, so the stored bitmap is sideways
and only upright once page rotation is applied.

Only `SPLITBA...pdf` page 2 has a text layer, 117 items and 1966 characters.

Consequence: text extraction cannot come from pdf.js. It requires OCR or a
vision model.

### The xlsx is an order-entry script, not a text dump

`LOP285120_ORDER_Config_VPN_PSB_KCP_Slipi.xlsx` is a single sheet of 35 rows
shaped `Nomor | Item I | Item II | Keterangan | value`, where Keterangan is one
of `Isi`, `Pilih`, or `Klik`. It tells an operator what to type into EPIC and in
what order.

Roughly 60 percent of its values are traceable to the two PDFs: the service
address, bandwidth, VRF name, project name, and the PIC phone numbers that
appear in the email. The rest exist only in EPIC or in a mapping tool, notably
Customer Account `C0004709285`, Billing Account `B0004806726/4806726`, Sales
Team `700032, 846163`, and the LatLong pair.

## Scope for v1

**In scope.** The eleven slots sourced from the two PDFs. The xlsx with column E
filled only where a PDF backs the value.

**Out of scope, by decision.** The five EPIC screenshots and the config xlsx
screenshot. Their slots are emitted as deliberately empty table cells, sized and
labeled, so the operator pastes into them by hand. This is the same posture the
sample already takes toward MOM, BASO, and the rest.

**Explicitly rejected for v1.** Driving the EPIC web app to capture those five
screenshots automatically. It needs credentials, network reach, and stable
selectors on a system outside our control.

## Architecture

Six stages. Each persists to IndexedDB so a run survives a reload.

| Stage | Runs where | Leaves the machine |
| --- | --- | --- |
| Render | pdf.js, honoring `/Rotate`, upright at 300 DPI, on demand | no |
| OCR | tesseract.js in a worker, words with pixel boxes | no |
| Classify | document-type spans derived from OCR text | text tokens only |
| Locate | per slot, numbered OCR lines in, line range out | text tokens only |
| Confirm | operator accepts or redraws on the page image | no |
| Export | docx with crops, xlsx with values and provenance | no |

Only Classify and Locate call Gemini. Classify sends text alone. Locate sends
text alone for the text-anchored slots, and adds the page image only for the
signature-block fallback described below, which in the sample bundle means the
single `TTD Pejabat` slot. So the common path uploads no images at all, which is
a stronger privacy posture than the chat route it replaces, where every page
went up as an image.

### Localization: OCR anchors, model picks lines

The core problem is producing a pixel rectangle for a slot such as
`KB / Tanggal` on a page with no text layer.

**Chosen approach.** OCR yields every word with a pixel box. The model receives
those words grouped into numbered lines, as text, with no image. It replies with
a line range. The app unions those lines' boxes and pads the result.

The rectangle therefore derives from real glyph positions and is exact by
construction. The model performs only the semantic step, choosing which lines
answer the slot, which is the part a language model is actually good at. The OCR
pass is not overhead, because the same text is what the xlsx needs.

**Fallback for regions without text.** `TTD Pejabat` is a signature and stamp
block with little OCR text to anchor to. For those slots the page image is sent
alongside the numbered lines so the model can express a region relative to
nearby lines, for instance from line 58 to the bottom margin. Where that also
fails, the operator draws the box, which the confirmation UI supports anyway.

**Rejected: asking Gemini for normalized boxes directly.** One call per slot and
no OCR dependency, but it stakes the product on the capability least likely to
hold. On a 3507 pixel page a one percent box error is 35 pixels, about one line
of text, and the `Tanggal` crop in the sample is a single 0.39 inch strip where a
one-line error is simply the wrong answer. Prior work on this project already
recorded doubt about coordinate output from vision models. This remains the
contingency if the measurement gate below fails.

**Consequence of OCR-first.** Page classification needs headings, not small
print, and the OCR text is already present, so classification costs no image
tokens at all. This must not later be "improved" into a vision pass.

## Data model

```ts
Run    { id, createdAt, sources: Source[], template: TemplateId }
Page   { runId, sourceId, index, widthPx, heightPx, lines: Line[] }
Line   { i, text, box: [x, y, w, h] }        // page pixels, upright orientation
Span   { docType: "KB" | "SP" | "BAPermintaan" | "Email", fromPage, toPage }
Slot   { key, label, section, docType, status, zone?: Zone, origin: "llm" | "human" }
// Slot.status: "pending" before locate runs, "proposed" once the model answers,
// "confirmed" once a human keeps or redraws it, "unfilled" for the slots v1
// leaves to the operator, "failed" when locate found nothing to propose.
Zone   { pageId, box, lineRange?: [from, to] }
Field  { row, itemI, itemII, keterangan, value?, source?: { pageId, lineRange } }
```

All boxes are in upright page pixel space, so rotation is resolved once at
render time and never again.

`Zone.lineRange` makes a proposal auditable and re-derivable. `Field.source`
fills the xlsx cell comments.

## Template configuration

`src/lib/forms/template.ts` declares the docx section list and the xlsx row list
together, because they are two views of one order. Keeping them in separate
places would let them drift on the first new order type.

The AO template ships as the only definition, expressed as data rather than
markup, so bidang TV 1 can add order types without a code change.

## Human in the loop

The operator reviews a **contact sheet**: every proposed crop on one screen,
with a bulk accept for the confident ones and drill-in for the rest. This is
fastest when the model is mostly right, which OCR-derived boxes should be, and a
systematic failure becomes obvious at a glance rather than eleven screens in.

Each proposal shows three things that make it judgeable without navigation: the
crop, the page and line range it came from, and the text those lines contain.
The line range is the tell. A proposal citing the wrong page, or a range far
longer than the slot warrants, reads as wrong immediately.

Correction is a drag on the page image. The rectangle snaps to OCR line
boundaries by default, since a crop slicing a line in half is never intended,
with a modifier key for free pixels on signature blocks.

Slots that v1 cannot fill render as deliberately empty with an explanatory note,
never as failures.

## Exporters

### docx

Generated from the template config with the `docx` library, not by patching the
sample file.

Patching a fixture would give exact Word fidelity, but the sample is full of
BSI's data and this project's rule keeps real client documents out of the repo.
A scrubbed blank fixture would solve that and reintroduce the drift problem,
because the fixture and the config would both describe the slot list. Generating
keeps one source of truth. The document is structurally simple: a header, some
headings, and two-column tables.

The `docx` package's advisory status is verified before it is added, given what
SheetJS taught this project.

**The header table is text, not crops, and needs its own sourcing.** Its six
fields come from three different places, and the operator confirms all six on
one form before export:

| Field | Sample value | Source |
| --- | --- | --- |
| ID EPIC | `LOP285120` | source file names, `LOP\d+` |
| QUOTE | `1-72989090591` | source file names, and the EPIC screenshots when present |
| CC | `BANK SYARIAH INDONESIA` | extracted from BA Permintaan, `Nama Pelanggan` |
| NAMA Proyek | `PSB VPN IP KCP Jakarta Slipi` | composed from BA Permintaan `Tipe Permintaan` and `Nama Lokasi` |
| JENIS ORDER | `AO` | operator picks, and it selects the template |
| ORDER | empty in the sample | operator, left blank by default |

The file-name derivations are heuristics and are presented as prefilled guesses,
never as settled values.

### xlsx

`exceljs`, already a dependency and already mandated over SheetJS. Thirty-five
rows from config. Column E filled only where a PDF backs the value, each filled
cell carrying a comment naming the page and line range. Unbacked rows stay
visibly blank rather than guessed at.

## Testing

Golden tests need documents and the real ones cannot be committed, so fixtures
are **synthetic**: a generator emitting a fake Indonesian contract scan with
known field positions, rendered and re-rasterised so it has no text layer, as
the real files do. All deterministic tests run against that. The real bundle in
gitignored `documents/` is for manual verification only.

Unit coverage targets the pure math that fails silently: line grouping from OCR
words, box union and padding, snap-to-line, and crop extraction under
`/Rotate 270`. That rotation is the most likely site of the first real bug.

`pnpm smoke` is kept and gains a locate case, so its guarantee moves from
"vision works" to "line-picking works".

## Measurement gate, before any UI

The sample docx is a labeled ground-truth set. Its eleven PDF-sourced crops are
a human's correct answers, and each has been traced to its source page.

Step one of implementation is therefore a harness, not a screen: run OCR and
locate over the real bundle, then compare proposed rectangles against those
eleven known-good crops.

A proposal **passes** when it lands on the right page, its box contains every
OCR line whose text appears in the ground-truth crop, and it adds no more than
two lines beyond them. That tolerates the padding differences between a human's
drag and a computed union while still failing a crop that misses a line or
swallows half a page.

- If nine or more of the eleven pass, the design holds and the UI is worth
  building.
- If not, we learn it for the price of a script rather than after the app is
  finished, and the direct-box approach or a different split becomes the answer.

Recording the per-slot result matters as much as the verdict. A failure
concentrated in one document type is a prompt problem; failures scattered across
all eleven are an approach problem, and they call for different responses.

## Constraints preserved

- Inference is the only thing that leaves the machine, and under this design it
  leaves as text rather than images.
- Sessions persist to IndexedDB. Document conversion stays in the browser.
- The API key stays server-side only, read in `src/lib/model.ts`, which remains
  the only file that knows how the model is reached.
- Real client documents stay out of the repo.
- Everything must run on a teammate's Mac, so OCR is WASM rather than a native
  binary.

## New rules for AGENTS.md

- **Self-host the tesseract wasm and `ind.traineddata`.** The library fetches
  both from a CDN by default, which puts an unapproved third party in the
  browser's request path and breaks the `performance.getEntriesByType("resource")`
  check. Same rule, same reason, as pdf.js keeping its bundled worker.
- **Never hold rendered pages in memory.** An upright 300 DPI page is 2480x3507,
  about 35MB as RGBA, and this bundle has 28 of them. Render on demand, keep
  only crops.
- **Page classification runs on OCR text, not vision.** Turning it into an image
  pass would cost about 30k prompt tokens per bundle for no accuracy gain.

## Open questions

- Whether the slot list varies by jenis order remains unconfirmed with bidang
  TV 1. The config-driven design absorbs a change without a rewrite, so this
  does not block implementation.
- OCR accuracy on Indonesian scanned contracts is unmeasured. The measurement
  gate above covers it, since bad OCR shows up as bad line ranges.
- Only two sample bundles exist. That is enough to test capture and not enough
  to claim accuracy.

## File layout

```
src/lib/model.ts               unchanged, still the only provider-aware file
src/lib/forms/template.ts      slot list and xlsx row list, config
src/lib/pipeline/render.ts     pdf.js, rotation, rasterise
src/lib/pipeline/ocr.ts        tesseract worker, words to lines
src/lib/pipeline/classify.ts   doc-type spans from OCR text
src/lib/pipeline/locate.ts     slot to line range to box
src/lib/export/docx.ts
src/lib/export/xlsx.ts
src/app/api/locate/route.ts    replaces api/chat
src/app/api/extract/route.ts
```

Deleted: the assistant-ui chat, `src/components/*`, and the thread history
adapters. They proved the inference path and that job is done.
