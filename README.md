# tv-helper

Turns a bundle of scanned Indonesian telecom order documents into two
deliverables:

- **`<ID EPIC>_DOKUMEN_VALIDASI.docx`**, a validation packet whose evidence is
  cropped pictures of the source pages, the way a person would screenshot them.
- **`<ID EPIC>_ORDER_Config.xlsx`**, the EPIC order-entry sheet, filled only
  where a source document backs the value, with every filled cell carrying a
  note naming the file, page, and line range it came from.

The scans have no text layer and are stored sideways (`/Rotate 270`), so the
pipeline renders each page upright at 300 DPI, OCRs it into words with pixel
boxes, groups those into numbered lines, and asks the model **which numbered
lines** answer a field. The rectangle then comes from the chosen lines' real
glyph boxes. The model is never asked for a pixel coordinate.

The assistant-ui chat under `src/app/` is leftover scaffolding that proved the
inference path. It still runs, and it is the only part of the repo that sends
images to the model, but it is not the product.

## Requirements

- Node 24 and pnpm. Nothing enforces the version, but the scripts import `.ts`
  modules directly and rely on Node's built-in type stripping, so an older
  runtime will not start them.
- A Gemini API key from [AI Studio](https://aistudio.google.com/apikey)

There is no local model server, no weights to download, and no GPU. Inference
runs on the Gemini API and every entry point fails loudly without a key. OCR
runs locally, in WebAssembly, and needs no credential.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then paste your key into it
pnpm smoke                   # proves inference works, no UI involved
pnpm test                    # the full unit suite, no API calls
```

`pnpm install` does not vendor the OCR assets by itself. `pnpm test` and
`pnpm build` both run `pnpm vendor:ocr` first (as `pretest` and `prebuild`), so
a fresh clone is fine; run it by hand if you are about to call the pipeline
without either.

## Generating the deliverables

```bash
pnpm generate documents/<bundle>.pdf documents/<splitba>.pdf
```

Writes both files into `out/` (override with `--out <dir>`). The whole run is
one command with no browser involved: render, OCR, classify, locate, crop,
extract, export. Expect several minutes on a first run, most of it OCR.

Useful environment switches:

| Variable | Effect |
|---|---|
| `GENERATE_FORCE=1` | bypass the OCR cache and re-OCR every page |
| `GENERATE_TIMEOUT_MS` | per-call ceiling, default 180000 |
| `MODEL_ID` | override the model, default `gemini-3.5-flash` |

OCR results are cached in the system temp directory, keyed by the source file's
content hash plus page and DPI, because OCR is a pure function of the pixels and
takes minutes. Model replies are deliberately **not** cached: a stale verdict
served silently is worse than paying for a fresh one.

The run prints, for every slot, the page and line range it chose and its
confidence; a `left for the operator` list naming anything it could not fill;
and a `cost:` line with total calls and tokens.

### What it does not do yet

`pnpm generate` writes both files unreviewed. There is no confirmation UI, no
manual zone selection, and no prompt for an additional document when a slot
comes up empty. Read the output's `left for the operator` list before handing
the deliverables to anyone.

## Measuring the locate step

```bash
pnpm measure:locate
```

Scores the locate step against the twelve human-authored crops in the sample
DOKUMEN VALIDASI docx. It reads real client documents and calls the real model,
so it is run by hand rather than in CI. `MEASURE_LOCATE_FORCE=1` re-asks instead
of reusing cached replies.

Recorded result: **page selection 12/12**, and **11/12 on extent by
containment**, the one genuine miss being `KB / ToP (2)`.

**Re-run this before and after any change to a locate prompt or a slot hint.**
It is the only thing that separates an improvement from a regression, and a
change that looks better while being worse is the exact failure this project
guards against.

## `documents/` is real client material, and is gitignored

Both `pnpm generate` (by convention) and `pnpm measure:locate` (by requirement)
read from `documents/`. It is in `.gitignore` alongside `test-docs/` and **must
stay that way**: this repo is public, and the client approving Google as a
processor did not make their files publishable.

`pnpm measure:locate` expects exactly three files in `documents/`, found by
shape rather than by name so a re-export under a slightly different filename
still works:

| File | How it is found | Why it is needed |
|---|---|---|
| the merged contract scan | the one `.pdf` whose name does not match `/splitba/i` | the Perjanjian Kerjasama and Surat Penunjukan pages (27 in the sample) |
| the SPLITBA scan | the `.pdf` whose name matches `/splitba/i` | the BA Permintaan and the printed email (2 pages in the sample) |
| the sample DOKUMEN VALIDASI | the only `.docx` in the directory | the ground truth the gate scores against |

A third `.pdf`, or a second `.docx`, makes the harness throw with the directory
listing rather than guess which file is which. Other file types are ignored.

`pnpm generate` takes its PDFs as arguments and does not need the docx.

Never commit a real LOP number, quote number, customer name, or project name.
The fictional set used throughout the tests is `LOP999001`, `1-70000000001`,
`BANK CONTOH NUSANTARA`, `PSB VPN IP KCP Contoh`.

## Commands

| Command | What it does |
|---|---|
| `pnpm generate <pdf...>` | the whole pipeline, both deliverables |
| `pnpm measure:locate` | score locate against the sample's human crops |
| `pnpm smoke` | reachability, text, streaming, vision, and per-image cost |
| `pnpm test` | pipeline and converter unit suites, no API calls |
| `pnpm vendor:ocr` | copy the tesseract wasm and traineddata into `public/` |
| `pnpm lint` | eslint |
| `pnpm dev` | the leftover chat scaffolding on http://localhost:3000 |

`pnpm smoke` is the honest inference test. If it passes, the credential and the
model are fine and any remaining bug is in this repo:

```
Smoke testing gemini-3.5-flash on the Gemini API
  mediaResolution=MEDIA_RESOLUTION_HIGH thinkingLevel=low maxOutputTokens=4096

  PASS  model is reachable                        (0.3s)
  PASS  text inference returns a correct answer   (1.5s)
  PASS  streaming delivers incremental chunks     (3.5s)
  PASS  vision accepts an image and describes it  (1.9s)
  PASS  a scanned page costs what we budgeted     (2.4s)
        1110 prompt tokens per page at MEDIA_RESOLUTION_HIGH;
        a full 5-page PDF costs about 5550 input tokens
```

## Cost

Every request is billed, so the settings that decide the bill live in one place
(`src/lib/model.ts`) and are all env-tunable.

**The pipeline sends text, not images.** Classify, locate, and extract upload
nothing but numbered OCR lines, so `GEMINI_MEDIA_RESOLUTION` does not affect a
`pnpm generate` run at all. What drives its cost is the size of the OCR listing:
one locate call carries every page of one document type, about 17k input tokens
for the sample bundle's contract.

The per-image numbers below apply to the chat route and to `pnpm smoke`.
Measured against `gemini-3.5-flash`:

| `GEMINI_MEDIA_RESOLUTION` | prompt tokens per image |
|---|---|
| `MEDIA_RESOLUTION_LOW` | 274 |
| `MEDIA_RESOLUTION_MEDIUM` | 528 |
| `MEDIA_RESOLUTION_HIGH` (default) | 1110 |

| `GEMINI_THINKING_LEVEL` | thought tokens |
|---|---|
| `minimal` | 0 |
| `low` (default) | ~40-100 |
| `medium` (Gemini's own default) | ~194 |
| `high` | ~324 |

- **Image tokens are a flat rate per tier, not per pixel.** A 224x224 thumbnail
  and a 1700x2200 page bill identically. Downscaling saves upload and IndexedDB
  space but not one API token.
- **Thought tokens bill at the output rate**, and `low` is the cheapest saving
  available against Gemini's default of `medium`, with no measured loss on field
  extraction. It applies to every call, image or not.
- **`GEMINI_MAX_OUTPUT_TOKENS` (default 4096) is a runaway guard, not a
  budget.** The model will otherwise emit up to 65536 tokens. A reply cut short
  logs a warning naming the variable.

Both `/api/chat` and `pnpm generate` log usage per call:

```
[chat] gemini-3.5-flash in=1101 out=178 (thoughts=177) total=1279 finish=stop
```

## Why these choices

**`gemini-3.5-flash`, chosen by measurement.** Newer is not automatically
better. `gemini-3.7-flash` is a newer GA flash tag and took 99-190s on a trivial
vision call with intermittent 503 "high demand" responses, past the chat route's
120s ceiling. `gemini-3.5-flash` answers the same probe in about 2s. Re-measure
with `pnpm smoke` before changing it.

**OCR anchors, the model picks lines.** Asking a vision model for a normalized
box directly would be one call per slot and no OCR dependency, but on a 3507px
page a one percent error is 35 pixels, about a line of text, and several crops
in the sample are a single strip where a one-line error is simply the wrong
answer. Deriving the box from real glyph positions makes it exact by
construction, and the OCR text is what the xlsx needs anyway.

**Whole-page slots skip the model entirely.** A `layout: "images"` section in
the template is a full-page capture, so `pnpm generate` takes the page directly.
Asking the model to find a whole page inside that page returned a
plausible-looking fragment every time.

**Self-hosted OCR assets.** No `.traineddata` ships inside `tesseract.js`, and
the library fetches both it and the wasm core from a CDN by default, which would
put an unapproved third party in the browser's request path.
`scripts/vendor-ocr.mjs` copies them out of `node_modules` into
`public/tesseract`, which is gitignored regenerated output.

**`exceljs`, not `xlsx`.** SheetJS on npm is frozen at 0.18.5 with two unpatched
HIGH advisories whose fixes ship only from the vendor's own CDN, and we parse
untrusted user files.

**The API call is server-side.** The key is read in `src/lib/model.ts`, has no
`NEXT_PUBLIC_` prefix, and never reaches the client bundle. With the app open,
`performance.getEntriesByType("resource")` should show zero external hosts.

**No local fallback.** Ollama is not deployed to production, so it is not kept
as a code path either. A dead branch that nobody runs is a branch that quietly
stops working.

## Known limits

- **Neither deliverable is reviewed before it is written.** The confirmation
  step, the contact sheet, and manual zone selection are designed and not built.
- **There is no vision fallback for signature blocks.** It is in the design;
  `locate.ts` has no image parameter. `KB / ToP (2)` is the slot it would help.
- **A slot that needs two crops gets one.** `KB / ToP` stacks two pictures cut
  from two different pages in the sample; the headless pass makes one call per
  slot and says so in its `left for the operator` list.
- **`namaProyek` ships blank on purpose.** Extracted from the full document
  pool it reliably picked the wrong title and carried a citation that passed
  validation. A blank invites the operator to fill it in; a plausible wrong
  value does not.
- **Only two sample bundles exist.** Enough to test capture, not enough to
  claim accuracy. OCR quality on Indonesian scanned contracts is measured only
  indirectly, through the locate gate.
- **Deployment is not built.** No Dockerfile, no auth, no allowlist.
- **Chat sessions are per-browser-profile.** IndexedDB is scoped to the origin.
- **Rate limits are the API's.** Bursts return 503 "high demand"; the pipeline
  retries six times with backoff and says so in the log.

## Layout

```
src/lib/model.ts               the provider boundary: model, cost, credential
src/lib/forms/template.ts      AO_TEMPLATE: docx sections + xlsx rows
src/lib/pipeline/render.ts     pdf.js, /Rotate, upright at 300 DPI
src/lib/pipeline/ocr.ts        tesseract worker, words with pixel boxes
src/lib/pipeline/geometry.ts   words -> numbered lines, union, pad, box
src/lib/pipeline/classify.ts   document-type spans from OCR text
src/lib/pipeline/locate.ts     slot -> line range -> box
src/lib/pipeline/fields.ts     xlsx values with validated citations
src/lib/export/png.ts          dependency-free PNG encoder
src/lib/export/crop.ts         sub-rectangle out of a rendered page
src/lib/export/docx.ts         the DOKUMEN VALIDASI packet
src/lib/export/xlsx.ts         the EPIC order-config sheet

scripts/generate.mjs           pnpm generate
scripts/measure-locate.mjs     pnpm measure:locate
scripts/vendor-ocr.mjs         pnpm vendor:ocr
scripts/smoke.mjs              pnpm smoke
scripts/test-pipeline.mjs      pipeline unit suite
scripts/test-converters.mjs    xlsx/docx extraction

src/app/                       the leftover assistant-ui chat scaffolding
src/lib/attachments/           its in-browser PDF/xlsx/docx conversion
src/lib/threads/, storage/     its IndexedDB session persistence
```

`AGENTS.md` carries the gotchas, the measured numbers behind each default, and
the rules that exist because an earlier version shipped a plausible wrong
answer. Read it before changing anything in `src/lib/pipeline/`.
