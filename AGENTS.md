<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# tv-helper

Turns a bundle of scanned Indonesian telecom order documents into two
deliverables that reproduce a human-authored sample:

1. `<ID EPIC>_DOKUMEN_VALIDASI.docx`, a validation packet whose evidence is
   **cropped pictures** of the source pages, in the manner of a screen capture
   rather than a text quote.
2. `<ID EPIC>_ORDER_Config.xlsx`, the EPIC order-entry sheet, with column E
   filled only where a source document backs the value and every filled cell
   carrying a note naming the file, page, and line range it came from.

The headless pipeline that produces both is built and merged. `pnpm generate`
runs it end to end with no UI and no browser involved.

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
| Extract | `src/lib/pipeline/fields.ts` | xlsx values, each with a citation that is **validated before it is trusted** (a hallucinated page, a reversed range, or a line the page does not have drops the citation but keeps the value: a false citation is worse than none) |
| Crop | `src/lib/export/crop.ts`, `png.ts` | the rectangle cut out of a re-rendered page, PNG-encoded with no image dependency (no `sharp`, no `pngjs`) |
| Export | `src/lib/export/docx.ts`, `xlsx.ts` | the two deliverables |

`src/lib/forms/template.ts` (`AO_TEMPLATE`) declares the docx section list and
the xlsx row list together, because they are two views of one order. It is a
**transcription of the sample, not a redesign**: section names, row labels,
order, the sections that ship empty, and the two-part KB table split all match
the sample as it stands.

### `pnpm generate` routes on `section.layout`, and that is load-bearing

A `layout: "images"` section is a **whole-page capture**: a human filling the
sample screenshots the entire page, so the page is taken directly and **no
model call is made**. Asking the model to find a whole page inside that page is
a category error, and it is exactly how those slots failed the first
measurement run: a plausible-looking fragment every time. Only `layout:
"table"` slots go through `locateSlot`.

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
- **`GEMINI_MEDIA_RESOLUTION` is therefore the DOMINANT validator cost lever,
  not a free one.** It used to affect only `/api/chat` and `pnpm smoke`; it now
  bills roughly 1110 input tokens per page at HIGH, flat, times every page of
  every bundle. The old text here said tuning it "changes no bill". That is
  exactly backwards now.
- **The other big driver is still the size of the OCR listing.** One locate
  call carries every page of one document type as numbered lines: about 17k
  input tokens for this bundle's KB contract. More pages of one doc type, or
  more `layout: "table"` slots, multiplies that directly.
- The per-image numbers in the cost table are correct and now apply to the
  validator path as well as to the chat route and the smoke test.

`pnpm generate` prints a `cost:` line with total calls and tokens, and every
call logs `in= out= (thoughts=) total=` exactly as `/api/chat` does, so cost is
visible in the run log rather than a month later on an invoice.

## The measurement gate

`pnpm measure:locate` (`scripts/measure-locate.mjs`) scores the locate step
against the human-authored crops in the sample DOKUMEN VALIDASI docx. It reads
gitignored client material from `documents/` and calls the real model, so it is
run by hand, not in CI.

Ground truth is not a hand-picked phrase: each of the twelve crop PNGs is
OCR'd with the same `ocrToLines` pipeline used on the full pages, so the
comparison is real text against real text from the same engine.

**Recorded result: a transcript, not a computation.** These numbers come from
one `pnpm measure:locate` run against `documents/`, landed by the commit
"Record what the measured run found, and stop a half-filled slot reading
empty" (`git log --oneline --grep "Record what the measured run found"` dates
it). Nothing in the tree recomputes them, so the only way to tell them from
stale ones is to run the command again.

- **Page selection: 12 / 12.** Every slot landed on the expected page across
  the sample bundle.
- **Extent: 11 / 12 by containment.** The one genuine miss is `KB / ToP (2)`,
  the Terms of Payment slot's second capture.
- It is twelve crops, not the eleven the original design names: `SP` and `KB /
  ToP` each supply two crops on two *different* pages, so each needs its own
  `locateSlot` call.

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

**Never re-tune the locate prompt or a slot `hint` without re-running the
gate.** It is the only thing that tells a gain from a regression, and the whole
failure class here is a change that looks better and is worse.

### The gate harness caches the opposite way round from `pnpm generate`

Verify this in `scripts/measure-locate.mjs` before trusting a gate number;
it is the one place a stale result can look like a fresh one.

- **Model replies ARE cached to disk**, keyed by the slot name plus a sha256
  of the exact prompt sent (`makeCachedAsk`). Re-running to tweak the scoring
  math therefore re-spends nothing, and a changed prompt or hint misses the
  cache by construction.
- **`MEASURE_LOCATE_FORCE=1` bypasses THAT cache only**, the model-reply one.
  It is the only bypass the harness has.
- **The OCR caches have NO bypass at all.** `ocrPageCached` is keyed by the
  document's *role* plus the 0-based page index -- `merged:0`, `splitba:1` --
  and returns a hit unconditionally, `FORCE_FRESH` unread. It does not depend
  on the filename or on the bytes. `ocrCropCached` is the same, keyed by the
  image name inside the sample docx. So **re-exporting a document silently
  scores the new pages against the old OCR**, under any filename, and the run
  looks entirely normal.
- **The fix is to delete the temp cache file by hand.** The harness prints all
  three paths at startup (`OCR cache:`, `Crop OCR cache:`, `Model-reply
  cache:`); delete `tv-helper-measure-locate-ocr-cache.json`, and
  `tv-helper-measure-locate-crop-ocr-cache.json` if the sample docx changed.

`pnpm generate` does not share this hazard: its OCR key is the file's content
hash, and `GENERATE_FORCE=1` bypasses it as well.

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
  (`NEVER_EXTRACTED` in `scripts/generate.mjs`) and ships blank. On the full
  pool it reliably picked the Surat Penunjukan's subject line, the master
  contract's scope title rather than this order's project name, and carried a
  citation that *passed* validation, in the docx header's `NAMA Proyek :` cell
  and its xlsx row. A blank invites the operator to fill it in; a plausible
  wrong value does not. Verify the current state with
  `git grep -n "NEVER_EXTRACTED = " scripts/generate.mjs`, which as the tree
  stands prints
  `scripts/generate.mjs:1008:export const NEVER_EXTRACTED = new Set(["namaProyek"]);`.

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
  slots are whole-page captures, so an uncapped width is most of the document's
  visual content, not an edge case.
- **A slot can hold more than one crop.** `SlotDef.crops` exists because the
  sample's `KB (lanjutan)` ToP row stacks two pictures in one cell. A
  `Map<string, FilledSlot>` keeps only the last and silently drops the other,
  shipping a document that looks complete and is missing evidence.
- **An empty section still emits its heading, and an unfilled table row still
  emits its row.** The sample ships MOM, BASO, BA Splitting, SBR Pricing, and
  BA Penjelasan Order empty, and the operator fills them by hand. A deliberately
  empty cell is the deliverable. (A `<w:tbl>` with no `<w:tr>`, on the other
  hand, is schema-invalid and Word refuses the file.)
- **Use `Packer.toArrayBuffer`, not `toBuffer`.** `toBuffer` asks JSZip for a
  "nodebuffer", which throws in a browser with no `Buffer` polyfill, and this
  pipeline is meant to run in the browser.
- **Never add `xlsx` (SheetJS) from npm.** Frozen at 0.18.5 with two unpatched
  HIGH advisories; fixes ship only from the vendor's CDN. Use `exceljs`, which
  is what `src/lib/export/xlsx.ts` and `src/lib/attachments/office.ts` import.
- **An xlsx cell note must name the source file and its own page number**, not
  this run's bundle-global page index. That global index is 0-based across
  every PDF on the command line, so for every page after the first source file
  it sent a reviewer to the wrong document.

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

Redesigned wholesale (branch `ui-rehaul`). The argument lives in
`docs/design-system.md` and the language in `docs/ui-bahasa.md`; read the first
before you move a token and the second before you write a string. What follows
is only the part that bites.

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

**Two hues in the whole product.** `--mark` (amber) means "a decision is owed
here" and nothing else, ever. `--gap` (red) means a fault or a refusal and is
absent from a healthy screen. Confirmed work has NO colour: it is an ink paraf
in a ruled box, so a finished packet is a screen with no colour left on it. The
old `--lt-mark` carried five unrelated signals at once, which teaches an
operator to read none of them.

- **Focus is ink, never amber.** A keyboard position is not a decision that is
  owed.
- **`.lt-paper` rebinds the ink tokens, and that is load-bearing.** Every token
  is defined against the graphite table, so on a white sheet `--ink` is
  invisible: the global `:focus-visible` rule drew a near-white outline on
  paper, measured at about 1.08:1, on the sign-in button among others. `--gap`
  and `--mark` get paper values there too, for the same reason.
- **`--ink-3` is the AA floor, measured, not estimated** (5.0:1 on
  `--surface-raised`, the lightest ground any of it sits on). It was 3.7:1 while
  carrying every safety advisory on screen. Quietness is bought with size and
  position, never with lower contrast, and nothing in the product is under 13px.
- **Only `.lt-paper` casts a shadow.** If a new component wants one, no.
- **Uppercase is reserved for quoting the document.** The interface never puts
  a label in caps to give it rank, which is what retires the tracked-out eyebrow
  labels. Positive letter-spacing appears in exactly two rules, the wordmark and
  `.lt-stamp`, both quotations.

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

**The flow is three phases, not four**: `1 Muat`, `2 Periksa`, `3 Berkas`. The
search runs from Muat as `Proses` (one word for one action, everywhere), and
Periksa is gated until it has run. The tambahan loop is no longer a phase: it is
the head of Periksa, and answering "yes" opens the ingest drop in a dialog.

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
accuracy measured on real scans. It is now the LARGEST lever on a
`pnpm generate` bill rather than no lever at all; see the section above.

The three levers, all env-tunable so a deployment can trade accuracy for cost
without editing code: `GEMINI_MEDIA_RESOLUTION` (images only, which since the
OCR migration means every page of every run),
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
- **Real client documents still never get committed.** `/documents` and
  `/test-docs` stay gitignored; you may read them, never stage them. This repo
  is public, and Google being an approved processor did not make the client's
  files publishable. **Never put a real LOP number, quote number, customer
  name, or project name in a committed file.** The fictional set used
  throughout the tests and this document is `LOP999001`, `1-70000000001`,
  `BANK CONTOH NUSANTARA`, `PSB VPN IP KCP Contoh`.

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
src/lib/model.ts               the provider boundary: model id, cost, credential
src/lib/forms/template.ts      AO_TEMPLATE: docx section list + xlsx row list
src/lib/pipeline/render.ts     pdf.js, /Rotate, 300 DPI, injected canvas
src/lib/pipeline/ocr.ts        tesseract worker, words with pixel boxes
src/lib/pipeline/geometry.ts   words -> numbered lines, union, pad, line range -> box
src/lib/pipeline/classify.ts   doc-type spans from OCR text
src/lib/pipeline/locate.ts     slot -> line range -> box
src/lib/pipeline/fields.ts     xlsx values with validated citations; reconcile
src/lib/pipeline/abbrev.ts     do two spellings denote one thing (see gotchas)
src/lib/pipeline/json.ts       the one extractJson every model reply goes through
src/lib/export/png.ts          dependency-free PNG encoder
src/lib/export/crop.ts         sub-rectangle out of a rendered page
src/lib/export/docx.ts         the DOKUMEN VALIDASI packet
src/lib/export/xlsx.ts         the EPIC order-config sheet (exceljs)

src/lib/browser/runtime.ts     THE browser-runtime surface; everything else
                               under browser/ is private to it
src/lib/browser/types.ts       BrowserRun, StoredPage, SlotState (+ rev)
src/lib/browser/ingest.ts      the render+OCR page loop, dependencies injected
src/lib/browser/pipeline.worker.ts  that loop, in a Web Worker
src/lib/browser/worker-client.ts    the page's side of it
src/lib/storage/runs.ts        IndexedDB: runs, pages, PDF bytes; the rev check
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

scripts/generate.mjs           pnpm generate: the whole pipeline, one command
scripts/measure-locate.mjs     pnpm measure:locate: the gate, real documents
scripts/vendor-ocr.mjs         pnpm vendor:ocr: wasm + traineddata into public/
scripts/smoke.mjs              pnpm smoke: reachability, text, streaming, vision, cost
scripts/test-pipeline.mjs      the pipeline unit suite
scripts/test-converters.mjs    xlsx/docx extraction

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

- **There is no vision fallback for signature blocks. It is DESIGNED, NOT
  BUILT.** The 2026-08-30 design specifies sending the page image alongside the
  numbered lines for `TTD Pejabat`, a signature and stamp block with little OCR
  text to anchor to. Nothing implements it: `locate.ts` takes no image
  parameter, and `Ask` is typed `(prompt: string) => Promise<string>`, so
  there is nowhere for an image to go. The gate scores all twelve slots
  text-only. Never describe it as the current path.
  (**And do not claim it would close the gate's one miss.** That miss is
  `KB / ToP (2)` -- Terms of Payment -- a different slot from `TTD Pejabat`,
  and text-heavy. The recorded 11/12 names `KB / ToP (2)` as the only miss,
  which means `TTD Pejabat` is currently passing text-only.)
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
- **`pnpm generate` writes its three output files unreviewed.** The design's
  "the app never emits an unreviewed zone" describes the UI's target, not this
  command.
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
