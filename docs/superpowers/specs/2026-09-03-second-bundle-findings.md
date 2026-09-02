# What a second client bundle changed

**Date:** 2026-09-03. **Basis:** four parallel investigations against the second
complete bundle the project has ever seen, delivered by the client as an
unorganised WhatsApp pile and unpacked into the gitignored `documents/new/`.

Client identifiers are deliberately absent from this file. The bundles are
referred to as **bundle one** (the original, an AO/PSB order for a VPN IP
service) and **bundle two** (an MO/renewal for a METRO E service). Every path
below is written with its LOP number elided as `<LOP>`.

---

## 1. The headline: the section list is NOT fixed

This is the load-bearing assumption in the tree and the second bundle breaks it.

Comparing the two human-authored Form Validasi documents, **only two of roughly
a dozen section headings are common to both.** Bundle two has no `SP`, no
`Email`, no `MOM`, no `SBR Pricing`, no `BASO`. It splits its contract checklist
across **three** separate tables -- a base agreement, an addendum, and a terms
of reference -- where bundle one has a single two-part `KB`. And it adds four
sections `AO_TEMPLATE` has never heard of.

So `AO_TEMPLATE` is not "the template with some sections left empty". It is a
**transcription of one order's document set**. Run against bundle two it would
emit a document whose headings do not match what a validator expects.

The scale differs by an order of magnitude too: bundle two's base PDFs are
**155 pages against 29**, its human output carries **56 PDF-backed crops against
12**, and the nine supporting PDFs in its zip add **372 more pages**.

**And there is a confidently-wrong cell shipping today.** `scripts/generate.mjs`
hard-codes `jenisOrder: AO_TEMPLATE.id`, so bundle two's header would read
**"AO" for an order that is an MO**. One line, wrong in exactly the way this
project is organised against: plausible, unflagged, and in a cell a validator
signs.

---

## 2. The xlsx: we have been searching the wrong corpus

The question was "why is column E empty, and should we skip the xlsx?" The
answer is that the xlsx is real and important, and that almost none of it lives
in the documents we are searching.

**What it is.** The `ORDER_Config` / `ORDER_Konfig` sheet is a **keying
worksheet that mirrors the EPIC (Siebel) quote form**. It is a long-lived Telkom
blank, one per service type, reused per order -- `docProps/core.xml` dates the
two we have to 2021 and 2022, both modified this year. Its `Item II` labels are
EPIC's on-screen field labels verbatim, and its `Keterangan` column is the
operator's instruction for HOW to enter each one: **`Isi`** type it, **`Pilih`**
choose from a dropdown, **`Klik`** press a button.

**Where its values come from.** Every filled value cell in both bundles was
classified by origin:

| Origin | Bundle one | Bundle two |
| --- | --- | --- |
| The ORDER REQUEST | 13 | 12 |
| Constant or dropdown for the service type | 13 | 12 |
| EPIC-internal id no document can supply | 3 | 4 |
| **The scanned contract PDFs** | **1** | **0** |
| Unknown | 1 | 3 |

**Zero to one cell of thirty-one needs the contract scans.** The pipeline is
asking a vision model to find, in a 29-page contract, values that are sitting in
a spreadsheet nobody told it about.

**The order request is a ROLE, not a file format.** Bundle two ships it as an
xlsx: row 1 type hints, row 2 headers, one row per SID. Bundle one has no such
file because its request arrived as an **email**, and that email is already a
page of the bundle -- the `Email` DocType exists in `classify.ts` and is simply
never mined for values.

**The two deliverables are not independent.** The finished config is pasted back
INTO the Dokumen Validasi as a picture: a PNG screenshot in bundle one under a
section named "Konfigurasi (Excel dari EPIC)", and EMF metafiles (what Excel
produces on copy-as-picture) in bundle two. So skipping the xlsx also leaves a
docx section permanently empty.

**The real workflow**, which nothing in this repo previously recorded:

    order request  ->  operator fills the config sheet  ->  operator keys EPIC
                   ->  operator screenshots EPIC as proof

Our output slots in **before** the keying step. That is what the client wanted
and why they expected the xlsx in the output.

**Ruling: do not skip it.** Stop treating it as a model-extraction target. Build
it as a deterministic mapping from the order request plus a per-service-type
constants profile, with the EPIC-internal ids deliberately left blank for the
operator. A blank invites the operator to fill it in; a plausible wrong id does
not.

---

## 3. The docx: patch a template, do not rebuild

The user's complaint was "image sizing too big for some and the font isn't
right, no header as well". All four parts measured true.

Our exporter ships **no `word/header1.xml`** (both samples have one, carrying
the DOKUMEN VALIDASI banner), **no `theme1.xml`**, an **empty `<w:docDefaults>`
with no `Normal` style** so the samples' Calibri-at-12pt falls back to Word's
own default, and **no `TableGrid` style** so our seven tables have no borders
where all thirteen tables across the two samples do. Images go out at 5.93-6.92
inches wide with a median height of 7.48 and a max of 9.80, against human crops
that run 1.60-5.93 wide and never exceed 6.27 tall.

**The approach is proven, not proposed.** `docx@9.7.1` already ships
`patchDocument` / `patchDetector`. Tested against the real sample: stripping all
17 image runs took the file from 1.41MB to 237KB, and patching crops back in
preserved `header1.xml`, `theme1.xml` and `styles.xml` **byte for byte**, along
with numbering, fontTable, settings, customXml and the `<w:sectPr>` with its
`<w:headerReference>`. The two-capture case (`SlotDef.crops`, the ToP row that
stacks two pictures in one cell) works inside a table cell under patching.

The three hard-won `ImageRun` facts in AGENTS.md all still hold under patching
and were each re-confirmed.

**The dangerous behaviour to guard.** `patchDocument` leaves an unmatched
placeholder in the output as literal `{{key}}` text, and silently accepts a
patch key the template does not contain. Both are wrong-and-quiet by default and
must be turned into errors.

**There is no single committable template.** The two samples share three section
names out of eleven and twelve, and bundle two's Konfigurasi table repeats a
four-row group once per SID. Combined with `documents/` being gitignored client
material, the template has to be a **per-run operator-supplied input**, produced
by a prep script rather than shipped in the repo.

---

## 4. The values route, and why it is not just a route

The operator UI wants the export step autofilled from document content. The
machinery exists on the Node side -- `extractFields` in
`src/lib/pipeline/fields.ts` returns values each carrying a citation that is
validated before it is trusted -- but the browser has no route to it.

**The blocker is not the route.** `fields.ts` cannot currently express the
distinction the UI needs: `citedSource` returns `undefined` both when the model
offered no citation AND when it offered one that failed validation. "Found,
uncited" and "found, citation was a hallucination" are the same value on the
wire. That needs an additive `CitationOutcome` in `fields.ts`.

**And the shared logic is in the wrong place.** Pool ranking, key grouping, hint
prepending and `NEVER_EXTRACTED` all live in `scripts/generate.mjs`, which a
server route must not import. They have to move to a shared pipeline module
first, or the route ships a second copy of `NEVER_EXTRACTED` that can silently
disagree with the first.

**Cost, measured not guessed:** the sample bundle's full OCR listing is ~73k
characters over 29 pages and 1,288 lines (~19-21k tokens), and `extractFields`
sends that listing once per docType-ranking group -- today exactly two groups,
so ~40-46k input tokens per extract request, against propose's ~150-160k.

**On the two poisoned fields:** return `namaProyek` only as a `not-searched`
disposition carrying its recorded reason, and return `cc` but never at
`confidence: "high"`. Both have shipped a wrong customer-facing value before.

---

## 5. What to do, in order

1. **`jenisOrder` stops being hard-coded.** One line, a confidently wrong header
   cell, and it should land first.
2. **Template-driven docx**: a prep script that strips a human docx to a
   template plus an anchor manifest, and a `buildDocx` that patches it. Keep
   `buildDocx(template, header, filled)` and `HeaderFields` stable -- the
   operator UI imports exactly those.
3. **Order-request reader as a first-class input**, ahead of the PDF search. It
   is structured, needs no OCR and no model call, and answers most of the xlsx.
4. **`/api/extract`**, after the `CitationOutcome` and the module moves.
5. **Per-run section list** -- the big one, deferred deliberately. Section KINDS
   (`wholePageCapture`, `documentChecklist`, `epicPaste`) assembled from what
   `classify` actually found, rather than a fixed transcription of bundle one.
   Every unevidenced section still emits its heading and lands in the
   outstanding report, which is what the sample already demands.

Items 1-4 are implementable now. Item 5 changes `src/lib/forms/template.ts`,
which another session is currently editing, and it deserves its own measured
landing rather than being folded into this batch.
