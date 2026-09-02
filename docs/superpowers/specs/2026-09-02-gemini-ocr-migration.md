# Implementation Spec: Gemini OCR migration

**Status:** approved to execute, conditionally. Read §1 before §3.
**Date:** 2026-09-02. **Basis:** one empirical probe (4 real pages, 20+ live calls), a four-area codebase map, three candidate designs.

---

## 1. Verdict on viability

**Viable. Execute.** The geometry is good enough, and the probe measured it rather than assuming it.

The load-bearing number: against tesseract's own glyph boxes on four real 300 DPI pages, **median IoU 0.897, p10 0.780**, and **99 of 104 blocks fully contain their glyphs once you allow the 12px `CROP_PADDING_PX` the exporter already adds**. There is **no systematic offset or scale error** (pooled edge deltas: left −3.4px, top −1.8px, right +0.1px, bottom −1.2px on a 2480×3507 page). The documented `[ymin, xmin, ymax, xmax]` 0–1000 convention came back exactly, and cropping a raw converted box with no correction produced a clean, complete picture on both a table cell and a paragraph. Text quality beats tesseract: every "tesseract-only" line on all four pages was tesseract noise, not something Gemini dropped.

That is the question AGENTS.md's central claim ("the model is never asked for a pixel coordinate") turns on, and the answer is that the model's coordinates are usable. The claim inverts, and we accept that.

**Two measured findings make this conditional, and the conditions are load-bearing:**

**Condition A — Gemini does not return visual lines on justified prose, and cannot be prompted into it.** A 43-line contract page came back as 23 blocks, 10 multi-line, one spanning 7 printed lines. A deliberately strict "one entry per physical line, no entry may ever contain a newline" prompt returned 22 blocks with 10 still multi-line, for 14 more input tokens. Every line-denominated constant in this tree (`FOOTER_GAP_MULTIPLE` 16, `MAX_FOOTER_LINES`, `HEAD_LINES` 12, `TOUCH_RATIO`, the gate's proportional-overshoot rule, the sample's twelve human crops running 2 to 43 lines) assumes one entry equals one printed line. **The producer must manufacture per-line granularity, not the prompt.** Task 3 does this.

**Condition B — Gemini confabulates small print confidently, deterministically, and invisibly.** A faint footer reference came back as **four different plausible strings across five whole-page calls**, never flagged, never declined. A partly ink-obscured stamp serial came back with **3 of 17 characters wrong, identically on all four calls of that page**. Tesseract fails these loudly ("Sa Pewa g A Pm 1 Sen"); Gemini fails them quietly and repeatably, which is strictly worse for a document a human signs. Re-sent as **crops**, Gemini read both 100% correctly, on both runs — so it is a whole-page tokenization artifact, not a model limit. **A crop-level second pass on every value bound for xlsx column E is not optional.** Task 10 does this.

**One honest correction to the stated motivation.** The probe measured Node tesseract doing the whole 27-page merged scan in **151.0s wall (110.8s OCR, ~4.1s/page), with the per-page `worker.terminate()` still in place**. The 20–25 minutes is therefore the **browser wasm path plus the serial ingest loop**, not the engine. Gemini at concurrency 4 is ~3.6s/page of model time plus ~1.7s/page of render+encode that has to happen regardless. **Gemini is comparable to Node tesseract, not an order of magnitude better.** Parallelising ingest (Task 9) would have delivered much of the browser win with tesseract still in place. The migration is decided and the case for it is real — better text on footers, page numbers, logos and column headers; deletion of ~68MB of dependencies, 48MB of vendored assets, ~250 lines of tesseract-lifecycle defence, and four build/deploy couplings — but **do not let the project record a speed claim it has not measured.** Task 1 takes the browser before-number.

---

## 2. Target architecture

### 2.1 The one new pipeline module

`src/lib/pipeline/gemini-ocr.ts` — pure, no provider SDK import, no network, no `fetch`. It is to OCR exactly what `classify.ts` is to classification: it takes an injected ask and returns the pipeline's own types.

```ts
// The image-capable ask. Declared HERE, not beside `Ask` in classify.ts,
// so classify/locate/fields stay provably text-only by reading one line.
export type ImageInput = { bytes: Uint8Array; mediaType: "image/png" };
export type AskImage = (prompt: string, image: ImageInput) => Promise<string>;

export const OCR_PROMPT_VERSION = "v1";   // hand-bumped; part of every cache key
export const OCR_PROMPT: string;

/** Reads width/height from the PNG's own IHDR. One source of truth for the
 *  coordinate space: it is impossible to hold the bytes without the dims. */
export function pngDimensions(png: Uint8Array): { width: number; height: number };

/** Node: encodePng. Browser/worker: OffscreenCanvas.convertToBlob. */
export function pageToPng(page: RenderedPage): Promise<ImageInput>;

/** The whole engine. Exported separately so it is testable OFFLINE. */
export function linesFromGeminiReply(
  reply: string, width: number, height: number,
): { lines: Line[]; report: OcrReport };

export function ocrPageWithGemini(
  image: ImageInput, ask: AskImage,
): Promise<{ lines: Line[]; report: OcrReport }>;

export type OcrReport = {
  blocks: number; segments: number; lines: number;
  interpolatedLines: number;   // lines whose box was sliced, not returned
  droppedEntries: number;      // failed box validation
  degraded: boolean; reasons: string[];
};
```

**`linesFromGeminiReply` is the whole design, in five moves:**

1. **Parse.** `extractJson` (`src/lib/pipeline/json.ts` — AGENTS.md requires every model reply go through it; it also handles fenced JSON) then zod. The prompt asks for `{"lines":[{"box_2d":[…],"text":"…"}]}` — an *object*, because `extractJson` spans first-`{` to last-`}` and a bare top-level array would not parse.
2. **Split.** An entry whose text contains N newlines covers N+1 printed lines. Slice its box into N+1 equal vertical bands, assigning each segment its band **before** dropping blank segments (dropping first shifts the surviving bands). Bands from a multi-line block are tagged `interpolated`; a single-line entry's band is its own returned box, tagged `measured`.
3. **Convert, with two scale factors.** `x = xmin/1000*W; y = ymin/1000*H; w = (xmax−xmin)/1000*W; h = (ymax−ymin)/1000*H`, W/H from `pngDimensions`. **Never a single scalar** — on a non-square page that is the classic plausible-wrong-rectangle bug. Validate: all finite; `xmax > xmin` and `ymax > ymin`; clamp to page; require `w ≥ 1` and `h ≥ 1` after clamping (a zero-height box is invisible to `linesTouchedBy` in `snap.ts`, so an operator's drag over it silently cites nothing).
4. **Guard the convention.** Drop a failing entry and count it; **throw** if `droppedEntries > max(3, 5% of entries)`. A model answering in pixels rather than 0–1000 fails nearly every entry, and that must be a loud error, not a thin page.
5. **Group.** Feed the bands to the existing, unmodified `groupWordsIntoLines` from `geometry.ts`.

**Move 5 is the load-bearing simplification and it deserves defending.** `groupWordsIntoLines` already sorts by y, groups by vertical overlap, orders left-to-right within a row, joins text with a space, unions boxes, and assigns `i` densely from array position. That single call satisfies **every clause of the drop-in contract at once**:

- `lines[k].i === k`, dense and 0-based — required by `boxForLineRange`'s `picked.length !== to − from + 1` throw (`geometry.ts:86`, verified) and by the three sites writing `lineRange: [0, lines.length − 1]` (`handler.ts:243`, `generate.mjs:748`, `measure-locate.mjs:1225`).
- Array order **is** reading order — required by four unsorted consumers: `buildLocatePrompt` (`locate.ts:316`), `extractFields` (`fields.ts:90`), the whole-page transcript (`handler.ts:314`), and the positional `lines.slice(0, HEAD_LINES)` in `classifyByDocType` (`handler.ts:168`, `generate.mjs:384`).
- It **fixes the probe's one measured ordering defect for free**: the two side-by-side BA-form headings that swapped index between runs land in the same overlap row and are ordered by x deterministically. A stored citation cannot change meaning on re-export.
- It **restores tesseract's granularity**. Gemini returns *finer* entries on form pages (50 vs tesseract's 37 rows, splitting label and value columns). Left unmerged, two cells at the same y contribute a near-zero top-to-top pitch, dragging down the median `trimRunningFooter` divides by — and `gap ≥ FOOTER_GAP_MULTIPLE × median` then fires where it should not, producing over-trimmed crops that cut real evidence and look fine. Re-merging same-row entries is what gives `FOOTER_GAP_MULTIPLE = 16`, `MAX_FOOTER_LINES`, `HEAD_LINES = 12` and the gate baseline a chance of surviving.

### 2.2 `Line`, and the one field that changes

```ts
export type Word = { text: string; box: Box };   // kept; see ruling 8.4
export type Line = {
  i: number; text: string; box: Box; words: Word[];
  origin?: "measured" | "interpolated";          // NEW, optional
};
```

`origin` is `"interpolated"` if any contributing band came from a multi-line block. It has **two real readers**, so it does not repeat the `words` mistake: `citeZone` surfaces it and `proposal-plate.tsx` renders a chip beside the existing "free pixels" chip, so an operator can see when a rectangle was sliced rather than returned; and the gate prints interpolated-line counts per slot. It is optional so pre-migration runs already in a browser's IndexedDB (`StoredPage.lines` is persisted opaquely by `runs.ts:152-166`, with no version check anywhere) read back as `undefined` and render as no chip.

New in `geometry.ts`, and it is the single written statement of the producer contract:

```ts
export function assertLinesWellFormed(lines: Line[], width: number, height: number): void;
```
Throws, with a named error per rule: `lines[k].i === k`; array order non-decreasing in `box.y`; every box finite, `w > 0`, `h > 0`, inside `0..width`/`0..height`.

### 2.3 Where the model call happens, and how the boundary survives

`src/lib/model.ts` stays the only file that knows how the model is reached. It gains **two exports and no call helper** (its contract is "hand out a `LanguageModel`, own the credential"; every caller already builds its own `generateText` with its own retry and cost logging, deliberately).

```ts
export const OCR_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS ?? 16384);
export function isTransient(error: unknown): boolean;   // moved in from generate.mjs:179-192
```

`OCR_MAX_OUTPUT_TOKENS` is scoped to OCR rather than raising the global cap: `MAX_OUTPUT_TOKENS` (4096, verified at `model.ts:52-54`) is a genuine runaway guard for four-field JSON verdicts and must not be deleted everywhere to serve one call site. The probe measured a dense page already emitting **2554** output tokens.

`isTransient` reads the error **object** (`isRetryable`, `statusCode`, `name`, on both the error and its `cause`) rather than `String(error)` — AGENTS.md records that a real Gemini 503 reads "This model is currently experiencing high demand" with no status code and no "unavailable" in `toString()`. It is currently private in a `.mjs` script that nothing in `src/lib` can import, which is why `/api/propose`'s `ask` has no retry at all. It is about to have three callers and it reads provider error shapes, which is what the boundary file is for.

| Path | Where the call is built | Boundary |
|---|---|---|
| **Node** (`pnpm generate`) | new `askImage()` beside the existing `askOnce`/`ask` in `scripts/generate.mjs`; it already imports `chatModel`, `providerOptions`, `MAX_OUTPUT_TOKENS`, `MODEL_ID`, `MODEL_TARGET` from `../src/lib/model.ts` | unchanged |
| **Node** (`pnpm measure:locate`) | the harness's own plain-`fetch` Gemini REST call gains an `inline_data` part. It deliberately does **not** go through `model.ts` and that stays true, with the same recorded caveat: the gate can pass while `model.ts` is broken | unchanged |
| **Browser** | new `/api/ocr`. `route.ts` is the only file that imports `model.ts`; `handler.ts` holds all control flow so `ocr.test.mts` drives the real gate with `node --test`, no Next runtime, no bundler, no credential | unchanged — the worker never sees a key, and there is no `NEXT_PUBLIC_` prefix anywhere |

`src/lib/pipeline/classify.ts:8`'s `export type Ask = (prompt: string) => Promise<string>` is **untouched**. Classify, locate and extract remain provably text-only, and `scripts/test-pipeline.mjs:324-329` ("buildClassifyPrompt sends text only, never an image") stays green and stays meaningful.

### 2.4 `/api/ocr` wire format

`POST /api/ocr`, `content-type: image/png`, **the raw PNG as the body**, read with `new Uint8Array(await req.arrayBuffer())`. No JSON, no base64 (a 33% tax on a 2.2–2.3MB page), no multipart, **and no metadata at all** — width and height come from the IHDR server-side, so there is exactly one source of truth for the coordinate space and no way for a caller to claim dimensions the image does not have.

Response: `{ width, height, lines: Line[], report: OcrReport }`. The client **asserts** `width/height` equal its own `RenderedPage` dimensions. That assertion is the guard against the single scariest silent failure in the migration: OCR measured at one DPI, the crop cut from a re-render at another. Everything downstream would look completely normal.

One page per request. Measured PNG is 2.24–2.32MB; Cloud Run's HTTP/1 cap is 32 MiB and Next's standalone server is plain `node:http`, so the HTTP/2 exemption does not apply. The whole 29-page bundle in one request is ~60MB PNG / ~80MB base64 and does not fit. Gemini additionally caps a whole inline-data request at 20MB. Per page is the decision, not the default.

`export const maxDuration = 120` in `route.ts` (probe max was 15.3s/page at concurrency 4; propose's 300 is for a many-call pass). Note `maxDuration` is **inert on Cloud Run** — Next reads it for platforms that consume the build output, and Cloud Run does not; `--timeout` is the real control.

---

## 3. Ordered task list

The tree is green (`pnpm lint`, `pnpm test`, `npx tsc --noEmit`) after every task **except Task 4**, which is called out.

---

### Task 1 — Baselines, before a single line changes
**Changes:** nothing in the tree. This task produces two numbers and a `.gitignore` line.

1. `probe-gemini-geometry.mjs` — **already gone from this tree** (verified: `git status --porcelain` shows only `?? mockups/`). Still add `/probe-*.mjs` and `/scratch-*.mjs` to `.gitignore` as a class rule. The probe hard-coded an absolute path whose *filename* contained a real LOP number and customer identifier, at the root of a **public** repo, and `.gitignore` covered `/documents` and `/test-docs` but nothing that merely names them.
2. **Delete by hand**, then run `pnpm measure:locate` unchanged:
   - `%TEMP%\tv-helper-measure-locate-ocr-cache.json`
   - `%TEMP%\tv-helper-measure-locate-crop-ocr-cache.json`

   Both are keyed by document **role** plus page index (`merged:0`, `splitba:1`, verified at `measure-locate.mjs:350`) and by bare image filename (`:449`) — neither carries the bytes, the filename, or the engine, and **neither honours any bypass**: `FORCE_FRESH` is consulted only in `makeCachedAsk`. The harness prints all three paths at startup.

   AGENTS.md's recorded 12/12 page selection and 11/12 containment are a transcript of one undated run that nothing recomputes. **Without a same-machine, same-week baseline the post-migration number is compared against nothing.** Paste the full output, including the printed footer-gap distribution and both margins, into this task's commit message.
3. **Time one real browser ingest** of the 29-page bundle with a stopwatch. The tree contradicts itself: `pipeline.worker.ts:81` says 40s/page (×29 = 19.3 min, which is where 20–25 comes from) while `ingest.ts:69`, `runtime.ts:303` and the operator-facing string at `ingest-panel.tsx:150` all say four to five seconds.

**Proves it works:** three recorded numbers in a commit message.

---

### Task 2 — `model.ts` gains an OCR cap and takes ownership of `isTransient`
**Files:** `src/lib/model.ts`, `scripts/generate.mjs`, `.env.example`, new `src/lib/model.test.mts` (add to `package.json:12`'s nine-suite list).

Add `OCR_MAX_OUTPUT_TOKENS` and `isTransient` per §2.3. Delete `isTransient` from `generate.mjs:179-192` and import it. Add a unit test driving `isTransient` with synthetic error objects — including the 503 shape whose `toString()` contains neither a code nor "unavailable", which is the case it exists for.

**Proves it works:** `pnpm test` green with a tenth suite; `pnpm generate` still retries identically (`GENERATE_TIMEOUT_MS`, `maxRetries: 0`, six attempts, `min(5000 × 2^i, 60_000)` backoff unchanged).

---

### Task 3 — Write `gemini-ocr.ts` and its offline test suite
**Files:** new `src/lib/pipeline/gemini-ocr.ts`, new `src/lib/pipeline/gemini-ocr.test.mts` (add to the test list), `src/lib/pipeline/geometry.ts` (add `origin` and `assertLinesWellFormed`), doc-comment edits in `geometry.ts` and `src/lib/export/png.ts`.

Implement §2.1 and §2.2 exactly. Reuse the exported `detectRuntime` from `ocr.ts` for `pageToPng`'s Node/browser branch — it is engine-agnostic and survives the removal; hoist it to `src/lib/runtime-scope.ts` in Task 12, not now.

Prompt: the probe's free-form wording **verbatim**, plus the JSON-object shape sentence. Do not spend effort forcing per-line output; it was tested and it does not work.

Doc-comment correction that matters: under Gemini, `Line.words` holds **one entry per printed-line band**, not per word. Rewrite `Word`'s comment to "a boxed text fragment — a word under tesseract, a per-line band under Gemini" so nobody reads per-word geometry into a field that no longer has it.

**Tests, all offline** (`pnpm test` makes no API calls and that guarantee survives). Drive `linesFromGeminiReply` with fixture reply *strings*, invented content only — `LOP999001`, `1-70000000001`, `BANK CONTOH NUSANTARA`, `PSB VPN IP KCP Contoh`; **never a line lifted from `documents/`**:

- a known `box_2d` converts to the expected pixel `Box` on a **non-square** page — proving the two axes scale independently
- a three-line block splits into three bands whose union equals the original box, in top-to-bottom order, all tagged `interpolated`
- contract assertions: `lines[k].i === k` for every k; every box finite and inside the page; reading order monotonic in y across rows
- **two entries at the same y in different columns come back as one Line in x order, identically regardless of the order the reply listed them** (the recorded ordering-swap defect)
- a fenced ```` ```json ```` reply parses
- a reversed range, a NaN, and an out-of-page box are each dropped and counted
- **a reply whose boxes are in pixels (values like 2480) throws** rather than returning a handful of survivors — the convention-mismatch guard
- a truncated reply throws
- `pngDimensions` pinned against a real `encodePng` output for a 7×3 image
- `assertLinesWellFormed` rejects: a gap in `i`, `i ≠ array position`, a box escaping the page, a NaN box, an array unsorted by y

**Proves it works:** `pnpm test` green; `npx tsc --noEmit` clean.

---

### Task 4 — Close the four quiet holes in existing consumers
**Files:** `src/lib/export/crop.ts`, `src/app/api/propose/handler.ts`, `src/lib/ui/evidence.ts`, `src/components/operator/proposal-plate.tsx`.

**This task briefly makes `propose.test.mts` fail** if its fixtures build `Line`s that do not satisfy `assertLinesWellFormed` — fix the fixtures in the same commit. That is the only expected red point in the plan.

1. **`cropToPng` does not catch NaN.** Verified by reading `crop.ts:23-28`: `if (w <= 0 || h <= 0)` is **false** for NaN, and so is `if (x < 0 || y < 0 || x + w > page.width || …)`. A NaN box passes both guards into `new Uint8ClampedArray(NaN * NaN * 4)` — a zero-length buffer and an empty image. Add `Number.isFinite` on all four. Add an optional `expect?: { width, height }` parameter; the export path passes `StoredPage.widthPx/heightPx`.
2. **`parseProposeBody` (`handler.ts:501-506`) validates only `Array.isArray(page.lines)`** — it never checks a `Line`'s shape, while validating the page-*numbering* contract twice and very carefully. Call `assertLinesWellFormed` there, **before the credential is spent**.
3. `citeZone` gains `interpolatedLines: number`; `proposal-plate.tsx` renders a chip when it is non-zero, beside the existing "free pixels" chip.
4. Add a one-line assertion at each of the three `lineRange: [0, lines.length − 1]` sites. Nothing throws today when that assumption is wrong; only the printed citation is silently wrong, which is the failure class exactly.

**Proves it works:** `pnpm test` green; a new `crop.test` case asserting a NaN box throws rather than producing a zero-length buffer.

---

### Task 5 — `pnpm generate` on Gemini, behind `OCR_ENGINE`, with an engine-tagged cache key
**Files:** `scripts/generate.mjs`.

Add `askImage(prompt, image)` beside `askOnce`/`ask`: same `generateText` shape with `messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: bytes, mediaType }] }]`, `maxOutputTokens: OCR_MAX_OUTPUT_TOKENS`, the same `abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)`, `maxRetries: 0`, and the same six-attempt backoff. **One difference from the text ask: `finishReason === "length"` must THROW, not warn.** A truncated locate reply fails to parse loudly; a truncated line list is a silently short page.

In `ocrEveryPage`, branch on `const OCR_ENGINE = process.env.OCR_ENGINE ?? "tesseract"` and **tag the cache key**:

```js
const engineTag = OCR_ENGINE === "gemini"
  ? `gemini:${MODEL_ID}:${OCR_PROMPT_VERSION}` : "tesseract";
const key = `${source.hash}:${DEFAULT_DPI}:${pageInDoc}:${engineTag}`;
```

The current key is `${source.hash}:${DEFAULT_DPI}:${pageInDoc}` (verified, `generate.mjs:322`). AGENTS.md promises this cache is hazard-free *because* it is content-addressed. **That promise dies the moment the engine is a variable**: the same bytes would hit the tesseract-written entry forever, and the run would look both fast *and* correct — the most convincing possible false positive. The tag makes an old entry structurally unhittable, and bumping `OCR_PROMPT_VERSION` invalidates on a prompt change by construction. `GENERATE_FORCE=1` (`generate.mjs:101`) still bypasses.

Leave the two-pass structure alone: pass 2 re-renders only the ~8–12 pages a zone landed on, and the reason for the split is memory (33.2MB RGBA × 29 ≈ 960MB), which is untouched by where OCR runs.

**Proves it works:** `OCR_ENGINE=gemini pnpm generate` produces both deliverables; the `cost:` line shows ~29 image calls; diff the docx crops and xlsx values page-by-page against a tesseract run of the same bundle.

---

### Task 6 — Move **both** sides of the gate to Gemini, and re-key its caches structurally
**Files:** `scripts/measure-locate.mjs`.

Add an `askImage` built from the harness's existing plain-`fetch` helper (an extra `inline_data` part). Route **both** `ocrPageCached` (`:356`) and `ocrCropCached` (`:465`) through `ocrPageWithGemini` under the same `OCR_ENGINE` var.

**Move both sides in one step.** One design proposed keeping tesseract as ground truth until a Gemini run exists; **reject it.** That compares Gemini page geometry against tesseract crop text through `findRequiredLineRange`'s 25%-of-signature-length fuzzy tolerance, tuned for a different engine's error modes — and the harness reports the mismatches as *"no window matched … (OCR-quality issue, not necessarily a locate failure)"* rather than as a regression. A diagnostic that hides the thing being measured is worse than no comparison. The symmetry ("real text against real text from the same engine") is the entire reason the numbers mean anything. The probe is encouraging here: crops are exactly the case where Gemini read perfectly.

**Fix the cache keys rather than documenting the hazard harder.** Add `:${MODEL_ID}:${OCR_PROMPT_VERSION}` and the PDF's content hash to `ocrPageCached`'s key; add the same tag to `ocrCropCached`'s. Make **both** honour `MEASURE_LOCATE_FORCE`. AGENTS.md's standing mitigation is "delete the temp files by hand", and that mitigation is about to cause exactly the failure it warns about. **A hazard that requires remembering is not mitigated.**

Do **not** re-tune `CROP_OCR_UPSCALE = 3` or `foldConfusables` in this task. Both are tesseract-shaped and probably wrong for a VLM, but changing them in the same run as the engine makes the result uninterpretable. Note them for Task 8.

Budget: the model-reply cache keys on `sha256(prompt)` and the prompt embeds the OCR listing, so new OCR text misses it by construction. **All eight field-slot calls are re-spent on the first post-migration run.**

**Proves it works:** the harness runs; both cache paths print with the new key shape.

---

### Task 7 — **GO / NO-GO.** Run the gate on Gemini and decide
**Files:** none. This is a decision point.

Delete both temp cache files by hand once more (belt, over Task 6's structural braces). Run `OCR_ENGINE=gemini pnpm measure:locate`. Compare against **Task 1's fresh baseline, never against AGENTS.md's transcript.**

Read three things specifically:
- **page selection** (was 12/12)
- **containment** (was 11/12; the one miss is `KB / ToP (2)`, Terms of Payment)
- **the two footer-gap margins the harness prints but never asserts** (`measure-locate.mjs:1342-1379`). If the `trimRunningFooter` margin collapsed, the granularity merge in Task 3 is not doing its job and the `KB / TTD Pejabat` nine-inch-crop-of-blank-paper defect is about to return. **This regression is silent in an automated run** — read those two lines by eye, every time.

Also read `report.interpolatedLines` per page. If interpolation is the common path rather than the exception, the design has quietly degraded to "trust the model box with a 12px pad", which the probe supports (99/104 within the pad) but which is not what was specified.

**This is where the change is cheap to abandon.** At this point the diff is one new module, two new test files, two script edits, four consumer guards and two lines in `model.ts`. Nothing user-facing has moved and no image has been uploaded from a browser.

**Do not re-tune the locate prompt, any slot `hint`, `FOOTER_GAP_MULTIPLE`, `CROP_OCR_UPSCALE` or `PASS_THRESHOLD` in the same run as the engine change.** Change one thing, re-run. That is the only instrument that tells a gain from a regression, and the whole failure class here is a change that looks better and is worse.

**If the gate regresses on extent and the footer margin is the cause:** the named fallback is a device-side ink-projection profiler (a horizontal luminance row-profile of the same rendered page, segmented into ink bands, with the model's box used only to assign text to a band and the band's box shipping as `Line.box`). That buys back *measured* per-line pitch. It is deliberately **not** in this spec — it is a second segmentation engine with thresholds calibrated on zero data, and the probe says we do not have the problem it solves. Reach for it only with a gate number that says otherwise.

---

### Task 8 — Re-derive the gate's constants, once, deliberately
**Files:** `src/lib/pipeline/locate.ts`, `scripts/measure-locate.mjs`.

Only after Task 7 is a go.

- `FOOTER_GAP_MULTIPLE = 16` was derived from a printed distribution (human crops' internal gaps 1.5×–8.5×; the one demonstrated footer 33×; 16 is the middle of the empty band). Re-derive it from the **new** printed distribution the same way it was derived the first time, and rewrite its comment with the new numbers in the house style.
- **Turn the printed footer-margin warning into a failure.** Those two constants are the ones whose meaning this migration could quietly change, and a printed-but-unasserted margin is a silent regression.
- Re-evaluate `CROP_OCR_UPSCALE = 3` (chosen because tesseract read the ~70–100 DPI docx crops as noise below 3×; Gemini reads crops better, and an unnecessary upscale is a free way to change results). Try 1 and measure.
- `PASS_THRESHOLD = 11` sets the process exit code and is calibrated to tesseract's line numbering. Re-set it against the new baseline and say so in its comment.

**Proves it works:** a second gate run with the new constants, recorded as a fresh dated transcript alongside Task 1's, each labelled with the engine it was measured with.

---

### Task 9 — `/api/ocr`, and the browser worker's four-line seam
**Files:** new `src/app/api/ocr/{handler.ts,route.ts,ocr.test.mts}`, `src/lib/browser/pipeline.worker.ts`, `src/proxy.ts` (comment only), `package.json`.

`handler.ts` per §2.4, copying `/api/propose`'s structure exactly:

```ts
export type OcrDeps = {
  gate: () => Promise<ApiGate>;
  recognize: (png: Uint8Array) => Promise<{ lines: Line[]; report: OcrReport }>;
  unreachable: (error: unknown) => Response;   // 503
};
export const MAX_PNG_BYTES = 8 * 1024 * 1024;
export function createOcrHandler(deps: OcrDeps): (req: Request) => Promise<Response>;
```

**Order is propose's order and that is the point: gate first and unconditional, then validate the body, then spend.** Validation before a token: PNG magic bytes; length ≤ `MAX_PNG_BYTES` else 413; IHDR parses with positive dimensions else 400.

**Copy `AskFailed`/`guardAsk` (`handler.ts:117-139`) in spirit, and make its OCR analogue stricter.** Propose earned this rule the hard way: a missing credential once returned 200 with every slot "outstanding", which reads as *searched and not found*. The OCR version is worse — **a 200 carrying zero lines is appended permanently to an append-only run, reads downstream as a blank scan, and then every slot legitimately reports not-found, indistinguishable from a genuinely empty document.** Unreachable model → 503 "nothing in your run has been changed". Unusable reply → 502. `finishReason !== "stop"` → 502, named, never parsed.

**Retry lives here**, four attempts on `isTransient` with generate's backoff. Propose's `ask` has no retry and survives it because one failed slot costs one slot; **a failed page of a 29-page ingest leaves a permanent hole** — `BrowserRun.pages` is append-only because `Zone.pageIndex` is a position in it, and there is no single-page re-OCR path.

Log `[ocr] <model> in= out= (thoughts=) total= finish= lines=` per page, matching propose and generate.

Worker (`pipeline.worker.ts:265-269` — the entire browser change, and it stays that size, because `IngestDeps.ocr` is already `(page: RenderedPage) => Promise<Line[]>` and already injected):

```ts
async function ocr(page: RenderedPage): Promise<Line[]> {
  const image = await pageToPng(page);
  const res = await fetch(new URL("/api/ocr", location.origin), {
    method: "POST", headers: { "content-type": "image/png" },
    body: image.bytes, credentials: "same-origin",
  });
  if (!res.ok) throw new Error(await messageFrom(res));   // surface the route's own text
  const body = await res.json();
  if (body.width !== page.width || body.height !== page.height) {
    throw new Error(`OCR measured ${body.width}x${body.height}, page is ${page.width}x${page.height}`);
  }
  return body.lines;
}
```

Three rules. (1) **No fallback to tesseract on error** — falling back on failure silently mixes two engines' geometry inside one bundle and turns a broken deploy into a 25-minute run nobody reports. A failure throws and reaches the operator through the existing `failed` protocol string. (2) `credentials: "same-origin"` stated explicitly even though it is the default. (3) `/api/ocr` **is inside `src/proxy.ts`'s matcher** (which excludes only `api/auth`, `api/health`, `signin`, `privacy`, `_next/*`, `favicon.ico`, `tesseract/`), so an unauthenticated worker fetch gets a **307 to `/signin`**, not a 401 — HTML arriving where JSON was expected, mid-ingest. This is precisely the failure `proxy.ts:90-98` records for `/tesseract/*.wasm`, relocated. Rewrite that comment rather than deleting it.

**`ocr.test.mts`** (added to the test list): an anonymous POST is refused **and `recognize` was never called**; a throwing `recognize` is a 503 whose body says the run was not changed; a non-PNG body is 400; an oversized body is 413; a good PNG returns the lines `recognize` produced, unmodified.

**Verify in a real browser before this task is considered done:** `/api/ocr` returns 200 and not a 307; pages land in ascending index with no gaps; `performance.getEntriesByType("resource")` still shows **no host but this app** (it should — the image goes to our own route, so *browser-talks-only-to-this-app* **survives** even though *documents-stay-on-device* does not; those two claims are conflated in `signin/page.tsx:15`, `auth/config.ts:7` and `pipeline.worker.ts:20-21`, and separating them is part of this change). If a dedicated worker's fetch does not carry the 12h session cookie, the contained fallback is to proxy the call through the main thread with a new protocol message pair.

**Also note and surface:** `pnpm dev` with no API key currently ingests fine ("OCR is entirely local and needs no credential"). After this, ingest requires the credential. The ingest panel's error copy must say so rather than showing a bare fetch error.

**Do not touch `ingest.ts` in this task.** It stays strictly serial, `browser.test.mts:317-346` stays green, no page can arrive out of order.

---

### Task 10 — The crop-level second pass on every value bound for column E
**Files:** new `src/lib/pipeline/verify.ts`, `scripts/generate.mjs`, `src/lib/pipeline/fields.ts`.

This is Condition B and it is the reason to design rather than swap.

```ts
export function reOcrCrop(crop: ImageInput, ask: AskImage): Promise<string>;
export function agreesWith(a: string, b: string): { agree: boolean; distance: number };
```

`agreesWith` normalises whitespace and case and folds the `{l,i,1}`/`{o,0}` confusables already established at `measure-locate.mjs:488-494` — those are glyph confusions, engine-agnostic, not tesseract-specific.

Wire in `generate.mjs` after `extractTextFields` (`:1229`) and before `buildXlsx` (`:1291`): for each value carrying a **validated citation**, re-render its cited page, `boxForLineRange` its citation, `cropToPng`, verify. **On disagreement, do not pick a winner** — blank the cell and record both readings, exactly like the existing CONFLICT path at `:1236-1245`, and exactly the disposition AGENTS.md argues for over fusing. A blank invites the operator to fill it in; a plausible wrong value does not.

Scope: generate only, and that is correct — `extractFields` has exactly one production caller (`generate.mjs:1073`); the browser proposes zones but does not extract xlsx values. Cost: ~15 values × ~1240 in / ~100 out tokens. Negligible.

**Two alternatives explicitly rejected.** (a) *A second whole-page OCR call as a disagreement detector*: the probe measured five calls of the same page returning byte-identical text and an identical output token count — it is deterministically wrong in the same place, so a second call buys nothing. (b) *Keeping tesseract as an on-device text cross-check*: it reads garbage in exactly the regions where Gemini is confidently wrong, so it cannot adjudicate, and it costs back the runtime the migration exists to remove.

**State the limit plainly wherever this is documented: it verifies VALUES, not CROPS.** A docx crop of the wrong region is the more expensive half of this project's failure class and this pass does nothing for it. Only `pnpm measure:locate` catches that. Nobody should read the second pass as making the gate optional.

**Proves it works:** a `pnpm generate` run whose log shows a verification line per cited value; a deliberately corrupted value in a test fixture blanks its cell and records a conflict.

---

### Task 11 — Parallel ingest, at 4, with strictly ordered append
**Files:** `src/lib/browser/ingest.ts`, `src/lib/browser/runtime.ts`, `src/lib/browser/browser.test.mts`, `scripts/generate.mjs`, `src/components/operator/ingest-panel.tsx`.

Separate commit, so it reverts independently of the engine.

Add `IngestDeps.concurrency` (default 4). Rewrite `ingest.ts:84-109`'s serial loop as a bounded pool: at most `concurrency` pages in flight, each doing `getPage → render → ocr → cleanup`, **results buffered and `onPage` fired in strictly ascending `page.index`, never overlapping.**

**Ordered append is not optional.** `runtime.ts:344-400`'s callback takes `const order = run.pages.length` (arrival position), advances `rev` in arrival order, and `withAppendedPage` pushes to the **end** of `run.pages` while ignoring the page's own `index`. `Zone.pageIndex` is a **position** in that array. Out-of-order arrival silently repoints every zone: a docx crop of the wrong scan that opens fine and gets signed. The `rev`/`appendPage` promise chain itself is safe under concurrency; `order` and the append position are what break.

**`browser.test.mts:317-346` ("ingestPdf awaits onPage before starting the next page", asserting `inFlight === 1`) gets REWRITTEN, not deleted.** The tempting fix is to loosen it. Instead, strengthen it: make the fake OCR resolve page 2 before page 0, and assert `onPage` still fires in ascending `page.index` and that two `onPage` calls never overlap. That test is the only guard on the wrong-page failure.

**Rewrite `ingest.ts:55-71`'s docstring in the same edit.** It states "no two rendered pages are alive at once" as a documented invariant; leaving it there means the next reader restores concurrency 1 as a bug fix. It becomes "at most `concurrency` rendered pages are alive at once" — 4 × 33.2MB ≈ 140MB peak, a bound; 29 is the gigabyte the invariant exists to forbid.

Apply the same pool to `generate.mjs`'s `ocrEveryPage`, with the same buffered ordered append — `index: pages.length` (`:353`) makes the global page index a function of push order. Also add the missing `page.cleanup()` there (`ingest.ts:107` has one; generate does not, and `source.doc` stays open for the whole run, so pdf.js already accumulates decoded images).

Update `ingest-panel.tsx:150`'s operator-facing "About four to five seconds a page" — it contains no tesseract token, so no grep for this migration finds it.

**Per-page failure policy, decided explicitly rather than inherited:** after retries exhaust, the page **fails the ingest loudly** and `runtime.ts:401-408` keeps the committed pages, as today. A run with a silently blank page is exactly the wrong-and-quiet shape; recording a failed-page state needs a new `StoredPage` state and touches the rev/append machinery, and does not belong here.

**Proves it works:** the rewritten test; a timed real browser ingest compared against Task 1's number.

---

### Task 12 — Retire tesseract, in this order
**Files:** see §5. Separate commit, only after Tasks 7–11 are green.

The order matters because the couplings fail the build if unwound wrong. Full list and ordering in §5.

---

### Task 13 — Docs, privacy page **in the same commit as the first image upload**
See §7. The privacy page edit is not a follow-up; it ships with Task 9.

---

## 4. Guardrails kept, and why

Every one of these exists because some version of this code produced a plausible wrong answer instead of an error. **None is negotiable for speed.**

| Guardrail | Where | What it catches |
|---|---|---|
| Two scale factors, never one scalar | `linesFromGeminiReply` | Plausible rectangles in the wrong places on a non-square page |
| Convention guard: throw if >max(3, 5%) entries fail box validation | `linesFromGeminiReply` | A model answering in pixels degrading into a thin page instead of an error |
| Throw on `finishReason !== "stop"`, never parse | `askImage`, `/api/ocr` | A truncated line array reading as a sparse page |
| `OCR_MAX_OUTPUT_TOKENS = 16384`, scoped to OCR | `model.ts` | A dense page (2554 measured) running past the 4096 runaway guard |
| `AskFailed`/503 + **never a 200 with zero lines** | `/api/ocr/handler.ts` | An unreachable model appending a permanent blank page that makes every slot legitimately outstanding |
| Client asserts returned `width/height` == its `RenderedPage` | `pipeline.worker.ts` | OCR measured at one DPI, crop cut at another — invisible downstream |
| `assertLinesWellFormed` at the producer **and** at `parseProposeBody` | `geometry.ts`, `propose/handler.ts` | A malformed `Line` reaching the credential, or reaching `cropToPng` |
| `Number.isFinite` guards in `cropToPng` | `crop.ts` | A NaN box passing both existing guards into a zero-length buffer |
| Deterministic sort via `groupWordsIntoLines` | `gemini-ocr.ts` | The measured column-order swap changing what a stored citation means on re-export |
| Engine + model id + prompt version in every OCR cache key | `generate.mjs`, `measure-locate.mjs` | Tesseract text served at Gemini speed — a run that looks fast *and* correct |
| Crop-level second pass, conflict blanks the cell | `verify.ts` | Confident, deterministic small-print confabulation reaching column E |
| `origin: "interpolated"` chip on the plate | `evidence.ts`, `proposal-plate.tsx` | A sliced rectangle presented as a measured one |
| Footer-gap margin **asserted**, not printed | `measure-locate.mjs` | Silent recalibration of `FOOTER_GAP_MULTIPLE` |
| No runtime tesseract fallback in the browser | `pipeline.worker.ts` | Two engines' geometry mixing inside one bundle |
| Ordered append under concurrency | `ingest.ts` | Every `Zone.pageIndex` repointed at the wrong page |

---

## 5. What gets deleted, precisely

**Task 12, in this order. The order is the point.**

1. **Tests first.** `scripts/test-pipeline.mjs:159-201` (the real-worker round trip), `:208-249` (the `loadLanguage`-hang timeout asserting `/300ms/`, `/langPath/`, `/pnpm vendor:ocr/`), `:251-314` (the `serialize()`/MessagePort leak-guard regression test). The last two pin tesseract.js@7 defects and are meaningless without it. **Retarget** the eight `groupWordsIntoLines` grouping tests (`:62-155`) — the function survives and is now the granularity restorer, so those tests get *more* load-bearing, not less.
2. **`scripts/test-pipeline-types.ts`** and its import at `test-pipeline.mjs:1494`. Its `@ts-expect-error` on `OcrAssets` is the only compile-time assertion in the suite; deleting the type without deleting this file makes it an *unused-directive error* under `tsc` while `pnpm test` stays green. **Add a `typecheck` script to `package.json`** in the same commit — there is no CI here and `tsc` is manual.
3. **`src/lib/browser/browser.test.mts:110-161`**, the four vendored-asset tests. **Note what is lost:** `:125-131`'s `!/cdn|jsdelivr|unpkg/i` assertion is the **only automated no-external-host check in the repo**. Replace it with an assertion that the OCR transport URL is same-origin and that no `generativelanguage.googleapis.com` string and no API key can reach the browser bundle. **Retarget** the `detectRuntime` tests (`:81-104`) at the hoisted `src/lib/runtime-scope.ts` — `png.ts` still needs the Node/browser branch.
4. **`Dockerfile`**: the nine-asset assertion loop (`:177-191`). For `COPY --from=builder /app/public ./public` (`:153`) — `git ls-files public` returns only `public/tesseract/.gitkeep` and `.dockerignore:24` excludes that path, so `/app/public` exists **only because `prebuild` ran**. **Keep the COPY and add a tracked `public/.gitkeep`.** Do **not** touch the health-endpoint assertion (`:64-80`), the `require('next/dist/server/next')` load check, or `test -d ./.next/static` on the same RUN line. Removing tesseract is **not** a licence to move to alpine — the real reason for debian-slim is Next's native SWC binary and glibc.
5. **`package.json`**: `vendor:ocr`, `pretest`, `prebuild` — in that order, after step 4.
6. **`scripts/vendor-ocr.mjs`** — the whole file. Do **not** delete `scripts/env.mjs`; other scripts share its `repoRoot`.
7. **`public/tesseract` off disk FIRST**, then `.gitignore:59-63`. Reversing that order stages **48MB of binary into a public repo.**
8. **`.dockerignore:22-24`** and **`.gcloudignore:15`** — those lines only. Do **not** delete `.gcloudignore` wholesale: it exists because gcloud otherwise falls back to `.gitignore`, which HEAD (`088cdec`, "Pin the Cloud Build upload context") landed specifically to stop.
9. **`next.config.ts`**: the whole `async headers()` block (`:20-43`) — it matches only `/tesseract/:path*`. Keep `output: "standalone"`; reword its comment.
10. **`eslint.config.mjs:18`** (`"public/tesseract/**"`). **KEEP `:24` (`".claude/**"`)** — its reason is in-repo git worktrees carrying their own `.next/` and `public/`, and 14 exist here; deleting it makes `pnpm lint` report another worktree's errors as this tree's. While in the file, delete the already-inert `:26-46` narrowing block for five `src/components/*.tsx` files that no longer exist.
11. **`src/proxy.ts:127`**: drop `tesseract/` from the negative matcher **and nothing else**. `api/health` is asserted by `Dockerfile:64-80` (the build fails without the lookahead), `signin`/`api/auth` prevent a redirect loop, `privacy` is required publicly by Google's OAuth consent screen. Rewrite the comment rather than deleting it — the fact it records (a Web Worker's fetch does not carry the session cookie the way a document request does) is now relevant to `/api/ocr`.
12. **`src/lib/pipeline/ocr.ts`** — the whole file, after hoisting `detectRuntime`/`RuntimeScope` to `src/lib/runtime-scope.ts` and repointing `png.ts` at it.
13. **`package.json` dependencies**: `tesseract.js`, `@tesseract.js-data/eng`, `@tesseract.js-data/ind`. ~68MB of `node_modules`, plus `opencollective-postinstall` leaving the install graph.

**Explicitly NOT deleted:**
- **`src/lib/export/png.ts`** — needed *more* now, as the encoder on the upload path. `crop.ts` and `scripts/png.mjs` already depend on it. Only its comments mention tesseract.
- **The pdf.js rules** — `GlobalWorkerOptions.workerSrc` set from the installed package (its default *is* a CDN) and `disableFontFace: true`. Those are about keeping third-party **hosts** out of the browser's request path, a different constraint from where documents are processed, and both survive intact.
- **`scripts/test-pipeline.mjs:324-329`** ("buildClassifyPrompt sends text only") — still factually true, still worth having.
- **`docs/superpowers/specs/` and `plans/`** — dated design artifacts. The repo already has a `2026-08-31-corrections` file establishing the pattern of superseding rather than editing. Add a new dated corrections note; editing them destroys the audit trail of why tesseract was chosen.

---

## 6. Measurement: what must be re-run, and which caches must be deleted

**Nothing in this tree recomputes an accuracy number. Every claim below requires a command.**

### The four caches, by exact filename

| File (in `%TEMP%` / `tmpdir()`) | Keyed by | Bypass | Action |
|---|---|---|---|
| `tv-helper-generate-ocr-cache.json` | `${source.hash}:${DPI}:${page}` — content-addressed, **no engine identity** | `GENERATE_FORCE=1` | Task 5 adds `:${engineTag}`. Delete by hand before the *first* pre-fix run only. |
| `tv-helper-measure-locate-ocr-cache.json` | `merged:0`, `splitba:1` — **document role plus page index; not the bytes, not the filename, not the engine** | **NONE.** `FORCE_FRESH` is read only in `makeCachedAsk` | **Delete by hand before Task 1's baseline and before Task 7's gate run.** Task 6 re-keys it and makes it honour `MEASURE_LOCATE_FORCE`. |
| `tv-helper-measure-locate-crop-ocr-cache.json` | bare image name inside the sample docx | **NONE** | Same. Delete by hand before Task 1 and Task 7. |
| `tv-helper-measure-locate-model-cache.json` | `${slot}:${sha256(prompt)}` | `MEASURE_LOCATE_FORCE=1` | Safe by construction — new OCR text changes the prompt and misses. Budget for re-spending all eight field-slot calls. |

**Why by hand, and why it matters more than any other line in this spec.** The two `measure-locate` OCR caches return a hit *unconditionally*, keyed on a role string that does not depend on the engine, the DPI, the filename or the bytes. Run the gate after switching engines with either file present and **the harness scores Gemini's proposals against tesseract's line numbering, on both sides, and prints a plausible total.** The run looks entirely normal. That is the single most likely way to obtain a fake "the migration didn't regress the gate" result, and it is why Task 6 replaces the procedural mitigation with a structural one.

### The measurement sequence

1. **Task 1, pre-migration:** delete both `measure-locate` OCR caches → `pnpm measure:locate` on the current engine → record page selection, containment, and the printed footer-gap distribution and both margins. Same machine, same week.
2. **Task 1, pre-migration:** one timed real **browser** ingest of the 29-page bundle. This, not `pnpm generate`, is the baseline the speed claim is judged against. `pnpm generate` will show a ~3-minute baseline and make the migration look like it bought little.
3. **Task 7, post-migration:** delete both again → `OCR_ENGINE=gemini pnpm measure:locate` → compare to (1), **never to AGENTS.md's transcript**.
4. **Task 8:** re-run after re-deriving `FOOTER_GAP_MULTIPLE`, `CROP_OCR_UPSCALE`, `PASS_THRESHOLD`. Record as a fresh dated transcript, **labelled with the engine**.
5. **Task 5/10:** `OCR_ENGINE=gemini pnpm generate` end to end, diffed against a tesseract run **crop by crop and value by value** — not "it ran".
6. **Task 11:** one timed real browser ingest, compared to (2).
7. **`pnpm smoke`, extended.** Its "a scanned page costs what we budgeted" check (`:196-223`) sends a synthetic **791×1024 solid-colour** PNG and asserts a token band. That check becomes the validator's real cost check after this migration, and a solid page and a dense 300 DPI scan **bill identically while reading nothing alike** — so smoke would keep passing while OCR quality collapsed at a lower `mediaResolution`. Add a hand-run real-scan OCR probe against `documents/`, separate from the token-band check.
8. **Storage back-compat:** open a run ingested **before** the migration. `StoredPage.lines` is persisted opaquely (`runs.ts:152-166` copies `lines: record.lines` without looking inside) and there is no version check anywhere. Old records carry `words` (harmless) and lack `origin` (optional, renders as no chip). Confirm it opens and exports.

**The recorded 12/12 and 11/12 are not comparable to any post-migration number.** Replace the transcript in AGENTS.md; do not amend it.

---

## 7. Doc changes

### Highest stakes, ships with Task 9 — not after

**`src/app/privacy/page.tsx`.** A published, dated, bilingual privacy policy, served **unauthenticated** (excluded from `proxy.ts`'s matcher) because Google's OAuth consent screen requires a reachable one. Its own header (verified, `:29-35`) says: *"The load-bearing sentences are that documents stay on the device and that only OCR text -- never a page image -- reaches the model on the validator path. If either stops being true, this page is part of that change."*

Three passages become false: `:65` "Dokumen Anda tidak diunggah", `:89` "Gambar halaman tidak ikut dikirim pada alur ini", `:154` "page images are not sent on this path". Bump `UPDATED` (`:41`, currently "2 September 2026").

**Write the narrower, truer sentence** rather than either the old text or a blanket retraction: *the PDF itself still never leaves the device — pdf.js renders it locally, the run lives in IndexedDB, and crops are cut in the tab. What now leaves, one page at a time, is a rendered page image, to this app's own server, which forwards it to the Gemini API for text recognition.*

Shipping Task 9 without this publishes a dated false statement about where customer scans go, in two languages, to an OAuth reviewer and to the client's own staff.

### `AGENTS.md` — named sections

- **"THE COMMON PATH SENDS TEXT, NOT IMAGES"** → rewrite as **"ONLY THE OCR STAGE SENDS IMAGES"**. Classify, locate and extract remain text-only; `Ask` still has no image parameter; `AskImage` has exactly one consumer. **Invert the cost guidance**: `GEMINI_MEDIA_RESOLUTION` was "free for the validator" and is now the dominant lever at ~1110 input tokens × 29 pages. Anyone reading the current section will price a run wrong by an order of magnitude.
- **"The client constraint, as it now stands"** → record a **third narrowing**, dated 2026-09-02, in the file's own house style: what changed, when, and by whose decision. The client dismissed the on-device requirement themselves, having done their own due diligence on Google, and cannot provide infrastructure. **State precisely what did not change:** the key is still server-side only with no `NEXT_PUBLIC_` prefix; real client documents still never get committed; **the browser still talks to nothing but this app** — now because `/api/ocr` *is* this app, rather than because nothing is sent. The pdf.js self-hosted-worker clause is independent and untouched.
- **"### OCR and tesseract"** (all six gotchas) → delete wholesale, replace with **"### OCR by Gemini"**: the two scale factors; block-not-line granularity and why the prompt cannot fix it; `OCR_MAX_OUTPUT_TOKENS` and the `finishReason` refusal; the measured ordering instability and why the `groupWordsIntoLines` re-merge is mandatory; the crop-verification pass and its stated limit.
- **"the typeof window worker blocker is FIXED"** correction → keep the pdf.js half and the `detectRuntime` positive-detection lesson (`png.ts` still needs it); delete the tesseract asset-path half.
- **The pipeline table row for OCR**; **"OCR, by contrast, is entirely local and needs no credential"** (now false, and it changes the dev experience); the **"Where things live"** entries for `ocr.ts` and `vendor-ocr.mjs`.
- **"OCR is cached, model replies are not"** is now self-contradictory, because OCR *is* a model reply. **Ruling, to be written down:** that rule exists to stop a stale semantic **verdict** — a classify span, a locate range — being served silently when nothing downstream re-checks it. A transcription of fixed, content-addressed pixels is not a verdict; it is re-read independently by the crop-verification pass and by the gate; and it is now expensive in money as well as minutes. Keep caching it, and make the key carry everything the reply depends on.
- **The gate's ground-truth claim** and the **recorded 12/12 / 11/12** — replaced by a new dated transcript, labelled by engine.
- **Pre-existing staleness to fix while in the file, because it will mislead the next agent worse than the constraint does:** `/api/propose` **does** exist and is the browser's proposal path (`handler.ts`, `route.ts`, `propose.test.mts`, `src/lib/ui/propose.ts`) — AGENTS.md says there is no such route and that nothing proposes a zone in the browser. The operator UI is **not** on the stub (`operator-app.tsx` imports `liveRuntime`; `stub-runtime.ts` throws in a production build; `wiring.test.mts` asserts it). `src/lib/ui/runtime.ts` **re-exports** rather than mirrors. `pnpm test` runs **nine** suites, not six (verified at `package.json:12`).

### Other docs

- **`README.md:241-248`** — the "Self-hosted OCR assets" section states self-hosting as a **privacy commitment on a public front door**. Highest-priority doc edit after AGENTS.md.
- **`docs/runbook-deploy.md`** — delete post-deploy **CHECK 5** (`:935-961`), an exact-byte curl of `/tesseract/ind.traineddata.gz` that would 404 by design; leaving it to fail reads as a regression. In **check 7**, drop the tesseract row but **keep** the pdf.js-worker and Web-Worker rows and the `performance.getEntriesByType("resource")` recipe — that property still holds. Add the sizing note: `--memory=512Mi` with no `--concurrency` (default **80**) and multi-MB buffered request bodies is an **OOM shape**, and a Cloud Run OOM kills the container along with every in-flight request. Start at `--memory=1Gi --concurrency=8` and measure. Leave the unrelated troubleshooting rows (DOMFilterFactory, StaleRunWriteError) alone. Note that the "15-20MB" figure for `public/tesseract` at `:85` is wrong — the directory measures **48M**, of which ~23M is the three non-LSTM wasm cores the app never loads.
- **Code comments asserting the constraint**, in descending order: `propose/handler.ts:10-21` (which explicitly demands *"the client's approval on the record"* — the 2026-09-02 dismissal **is** that record and belongs written there, dated); `propose/route.ts:48-56` ("TEXT ONLY"); `src/lib/ui/propose.ts:128-133`; `src/lib/ui/crops.ts:8-11` (its first two sentences stay true, only the third changes); `pipeline.worker.ts:9-21` (**rewrite around the pdf.js clause, never through it**) and `:216-221` (an *operator-facing* error string whose advice stays correct only while the PDF really does stay local); `src/lib/browser/runtime.ts:33-39`; `signin/page.tsx:15`; `auth/config.ts:7`; `proposal-plate.tsx:78`; `zone-editor.tsx:313`; and the untracked `mockups/02-ingest.html:80`, `mockups/05-outstanding.html:103`.
- **`ingest-panel.tsx:150`** — "About four to five seconds a page", rendered to the operator, containing no tesseract token. Separately observed, not part of this task: it is English, and the standing preference is Bahasa Indonesia for operator copy.

---

## 8. Where the three designs disagreed, and the rulings

**8.1 — Ink-projection profiler as the geometry source (Design C) vs. trusting Gemini's boxes (A, B).**
**Ruled: trust Gemini's boxes; keep the ink profiler as a named fallback only.** C's design is the most intellectually attractive — it keeps the property that a box cannot lie because it is a mechanical consequence of pixels. But the probe already measured that we do not have the problem it solves: median IoU 0.897, no systematic offset, 99/104 contained within the pad the exporter already adds. Adding a second segmentation engine with a luminance threshold, a minimum-ink-per-row, a band gap and a minimum band height — **four constants calibrated against zero data** — to fix a measured non-problem is the wrong trade on a first landing, and it puts geometry code in the browser bundle that a server deploy cannot fix. Recorded in Task 7 as the fallback if the gate regresses on extent.

**8.2 — Reuse `groupWordsIntoLines` (A) vs. a new `sortAndNumber` (B).**
**Ruled: reuse.** It satisfies the entire drop-in contract in one already-tested function, it fixes the measured ordering-swap defect for free, and — the argument that decides it — **it re-merges same-row entries, restoring the granularity every calibrated constant in this tree assumes.** B's `sortAndNumber` deliberately does *not* merge columns, which would leave `FOOTER_GAP_MULTIPLE`, `HEAD_LINES` and the gate baseline all measuring something different at once, with no baseline to judge the result against. Finer granularity is genuinely better evidence; revisit it as a separate, separately-measured change.

**8.3 — `blockId` on `Line` (B) vs. nothing (A) vs. `origin` (C).**
**Ruled: `origin: "measured" | "interpolated"`, optional.** B is right that a field like this must exist; B is also right that `blockId` would repeat the `words` mistake unless something reads it. But B's stated reader — restricting `trimRunningFooter`'s pitch measurement to block boundaries — is weaker than it sounds: within-paragraph interpolated pitch is `blockHeight/N`, which *is* approximately the true leading. `origin` gets two real readers instead (the operator's plate chip, and the gate's per-slot count), which is what actually matters for trust, and it costs one optional field that old IndexedDB records read back as `undefined`.

**8.4 — Drop `Line.words` (B, C) vs. keep it (A).**
**Ruled: keep, for this landing.** The map's grep is correct and I verified it: nothing in production reads it. But B's main argument was payload size, and that argument defuses itself — under the new scheme `words` holds ~1 band per line rather than ~7 words per line, so the propose payload shrinks ~7× from the engine change alone. Dropping it would touch seven fixture builders across five files for no functional gain and would enlarge the revert. **Required mitigation:** rewrite `Word`'s doc comment to say "boxed text fragment — a word under tesseract, a per-line band under Gemini", because a field named `words` holding line-bands is itself a wrong-and-quiet naming hazard.

**8.5 — `/api/ocr` returns finished `Line[]` (A, B) vs. raw 0-1000 blocks reconciled on-device (C).**
**Ruled: return `Line[]`.** C's argument — the server never learns a coordinate space, so no scale bug can exist there — is real, and its actual goal (every rectangle computed from the device's own pixels) is preserved more cheaply by the client-side dimension assertion in Task 9. Returning `Line[]` means **`generate.mjs` and the route run the identical, once-tested `linesFromGeminiReply`**; C's split would either duplicate that conversion or ship it in the bundle where a deploy cannot fix it.

**8.6 — Parallelise ingest now (B, C) vs. not in this landing (A).**
**Ruled: yes, but as Task 11, its own commit, after the gate is green.** A is right that the ordering rewrite is the one change that can silently repoint every `Zone.pageIndex`, and right to keep it out of the engine commit. B and C are right that it is where the speed actually comes from — and the probe makes that decisive: **Node tesseract is already 4.1s/page, so the 20-25 minutes is the serial loop and the browser wasm build, not the engine.** Serial Gemini at ~12s/page is ~6 minutes, better than 20-25 but not obviously worth a migration on its own. Separate commit so it reverts independently.

**8.7 — `OCR_ENGINE` as a runtime kill switch including the browser (A) vs. no switch (B, C).**
**Ruled: `OCR_ENGINE` exists for the two scripts only, never for the browser path.** A's operational instinct is good — a one-variable revert on Cloud Run is worth a lot. But a runtime engine switch in the worker means two geometry sources can mix within one bundle, and, in A's own design, a broken deploy silently becomes a 25-minute run nobody reports. The scripts need the flag anyway for the A/B comparison in Tasks 5–8. **The browser's kill switch is reverting the commit.**

**8.8 — Delete the gate's caches by hand (A, and AGENTS.md today) vs. re-key them structurally (B, C).**
**Ruled: re-key.** This departs from AGENTS.md's own standing mitigation, deliberately. A hazard whose symptom is "the run looks entirely normal" and whose mitigation is "remember to delete a temp file" is about to cause exactly the failure it warns about. Hand-deletion still applies to the two runs that happen *before* the re-key lands (Tasks 1 and 7).

**8.9 — Crop-verification pass now (B, C) vs. follow-up (A).**
**Ruled: now, Task 10.** A names it as the debt it is least comfortable leaving, and A is right to be uncomfortable. It is the probe's number-one finding, the mitigation is measured to work (both regions read perfectly as crops, on both runs), and it costs ~15 small calls per run. Given that this project's entire organising principle is avoiding a plausible wrong answer a validator signs, shipping without it would be the wrong spec.

**8.10 — Raise `MAX_OUTPUT_TOKENS` globally (some map advice) vs. an OCR-scoped cap (B, and A).**
**Ruled: OCR-scoped.** The global 4096 is a genuine runaway guard for four-field JSON verdicts; deleting it everywhere to serve one call site is a real loss for no gain.

**8.11 — Gemini `responseSchema` (probe) vs. `extractJson` + zod (A, B).**
**Ruled: `extractJson` + zod is the correctness path.** AGENTS.md requires every model reply go through the one `extractJson`, it already handles fences, and `responseSchema` plumbing through `@ai-sdk/google` is unverified in this tree. The probe's 20/20 first-time parses are a reason to *add* `responseSchema` as hardening later if parse failures appear in the route log — never a reason for correctness to depend on it.

---

## 9. Open risks, and what to measure before trusting this in front of a validator

**Residual risks that this spec does not eliminate:**

1. **Confident small-print confabulation is mitigated, not solved.** The crop pass covers values bound for column E. It does **not** cover the locate prompt's own input, so a mis-transcribed line can still steer a slot toward the wrong section — and it does **not** cover the docx crops, which are the more expensive half of the failure class. A correct box carrying wrong text passes every mechanical check in this design.
2. **Four pages, one bundle.** The probe measured a dense justified contract page, a contract page with a key/value block, a signature-and-stamp page and a BA order form — all machine-printed, cleanly scanned, from the one client bundle. **Nothing here says how the boxes behave on a skewed scan, a photographed page, a fax-quality copy, or a rotated table.** AGENTS.md's own caveat applies unchanged: two sample bundles is enough to test capture and not enough to claim accuracy.
3. **Interpolated sub-line boxes are computed, not measured.** The 12px pad absorbs the error the probe measured, but `trimRunningFooter` divides by a median that now mixes real inter-block pitch with arithmetic within-block pitch. Task 8 re-derives the constant; whether that re-derivation is stable across bundles is unknown.
4. **The worker's session cookie is unverified.** A silent 401→307 mid-ingest surfaces only as `protocol.ts:38`'s generic `failed` string.
5. **Cloud Run sizing is an OOM shape** at `--memory=512Mi` with the default `--concurrency=80` and buffered multi-MB bodies. One operator's ingest could take other operators' in-flight requests down with the container.
6. **The browser has no OCR cache at all.** `runtime.ts:325` mints a fresh `crypto.randomUUID()` sourceId per run, so re-adding the same PDF re-OCRs every page. Under tesseract that cost local CPU; now it costs roughly $0.40–0.55 per re-ingest with **no indication to the operator.** Out of scope here; record it as a known gap rather than discovering it on an invoice.
7. **`TTD Pejabat` gains nothing.** Gemini read the printed names, titles and stamp text with correct boxes and correctly declined to transcribe the handwriting. That is right behaviour, but the designed-not-built vision fallback for signature blocks gets **no new text anchor** from this migration — the slot still passes on the printed matter around the ink, exactly as it does today.

**What I would want measured before a validator signs a Gemini-produced packet:**

1. **A second bundle**, and at least one deliberately degraded scan — skewed, photographed, or fax-quality. This is the largest unmeasured axis and it is cheap.
2. **A human review of all twelve crops from a full `OCR_ENGINE=gemini pnpm generate`**, side by side with the tesseract run's crops. Not the gate's containment score — a person looking at twelve pictures.
3. **The distribution of `report.interpolatedLines` across the 29 pages.** If interpolation is the common path, the design has quietly become "trust the model box with a 12px pad" — which the probe supports, but which is not what this spec specified, and the plate chip would then be on almost every proposal and stop carrying information.
4. **The crop-verification disagreement rate** on a full run. Zero disagreements would mean the guard is untested, not that it is unnecessary; one or two would confirm it is doing exactly the job it was added for.
5. **A timed real browser ingest, before and after Task 11**, so the project knows what it bought — and can say honestly whether the win came from the engine or from the loop.