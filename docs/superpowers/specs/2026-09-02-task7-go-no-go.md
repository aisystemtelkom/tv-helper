# Task 7 — GO / NO-GO

## VERDICT: **GO-WITH-FIX**, and a hard **NO-GO on Task 12** until the gate is re-run clean.

The migration is not worse at the thing it was measured on. It is worse at one thing that was never measured before, and that thing is squarely inside this project's expensive failure class: **Gemini intermittently returns a materially incomplete transcription of a whole page, with `finishReason=STOP`, zero dropped entries, and no degraded flag.** It hit 2 of the 29 pages in the gate run, and both happened to be pages carrying scored slots. That defect is real, it must be fixed before anything else is tuned, and it must be fixed with a guard rather than with a re-run.

**9/12 stands as the run of record for 2026-09-02.** Do not retroactively upgrade it to 11/12 on the strength of probe resamples. The gate is the instrument; probes are not the gate. What the probes buy is a diagnosis, not a score.

---

## 1. The three failures, ruled

I re-derived the key facts first-hand from `%TEMP%\tv-helper-measure-locate-ocr-cache.json` and `...-crop-ocr-cache.json` (both engine-tagged `gemini:gemini-3.5-flash:v2`) rather than taking any diagnosis at its word.

**Per-page returned-box coverage, all 29 pages, gate run:** 27 pages reach 0.94-0.99 of page height. Two do not. `merged:19` stops at **0.514** (21 lines, 898 ink characters, lowest box bottom y=1803 of 3507). `splitba:0` covers 0.811 but carries only 27 lines / 1060 ink characters, with **six boxes 2.3x to 6.8x the page's median line height each carrying a single 51-111 character line** -- a paragraph-sized rectangle with one printed line transcribed into it.

**The damning comparison, computed from the caches alone, no re-OCR:** the human crop `image1.png` of that same BA page OCR'd to **35 lines / 1568 ink characters**. The *page* OCR'd to **27 lines / 1060**. A crop of a region of the page contains 48% more text than the whole page's own reading. `findRequiredLineRange` cannot match what is not there, and it is arithmetically right not to.

| Slot | Verdict | Ruling |
| --- | --- | --- |
| **BA Permintaan** | FAIL | **Real pipeline defect, correctly refused.** Not a scorer artifact. The *picture* was correct by construction (`layout: "images"`, zone `[0,26]`, box = whole page, no model call), but the page's transcription was ~33% short, which corrupts its citation line range, its caption, and anything else that page feeds. The gate was right to withhold a pass. Its only sin is the wording. |
| **KB / ToP (1)** | FAIL | **Real wrong capture, root cause upstream of locate.** The chosen range `[11,20]` on a page whose text physically ended at 51% of the paper. The docx would have shipped a partial region of real evidence. This is not a locate regression: the model answered correctly against the listing it was given, and the listing was half a page. |
| **KB / ToP (2)** | FAIL | **Real, pre-existing, unchanged.** Tesseract chose `[6,15]` for required `[1,15]`; Gemini chose `[3,8]` for required `[0,8]`. Same shape, both engines, already recorded at `scripts/measure-locate.mjs:1103-1160` as measured-and-argued (starting every slot at line 0 fixes this one and breaks four others). Not attributable to the migration. |

**Score: zero of the three are scorer defects. Two are new, and both trace to a single new OCR failure mode. One is baseline.** The migration's true cost on this bundle is **one defect class, observed twice**, not two independent capture regressions.

### Ruling between the diagnoses

The four investigations agree on the mechanism and split on one word. Area 1 called BA Permintaan a "verification artifact"; area 4 called it "informative about the pipeline, not the scorer". **Area 4 is right and area 1's framing is the dangerous one.** "Verification artifact" invites the reading that the pipeline was fine and the instrument stumbled. The pipeline was not fine: that page came back a third short, and the fact that this particular slot's rectangle survives by construction is luck of slot type, not evidence of health. Area 1's own measurements support area 4's conclusion; only the label differs. Adopt area 4's.

On the ink-projection profiler, areas 2 and 3 reached the same verdict by independent routes (2 by counterfactual -- geometry is 2-5px of a 217-551px extent error; 3 by prototyping it and finding it loses the p99 and max while winning the median that the 12px pad already absorbs). Both are right, and neither of Task 7's two stated trigger conditions holds. **The fallback in spec §8.1 is not triggered. Do not build it.**

---

## 2. What the run measured that the score does not show

Task 7 asks for three specific reads. Two of them are worse news than the total.

**Interpolation is the common path, not the exception.** 845 of 1226 lines (69%) were sliced out of a multi-line block; 21 of 29 pages flagged degraded. Spec §9.3 named this exactly: if this happens, "the design has quietly become *trust the model box with a 12px pad*, which the probe supports but which is not what this spec specified." That is now the state of the tree. It is defensible on measurement (interpolated band centres land within about 0.05 of a line pitch, roughly 2-3px, inside `CROP_PADDING_PX = 12`), but it must be **recorded as a design outcome, not left implied**, and the operator plate's "interpolated" chip now fires on the majority of proposals and has stopped carrying information.

**The `degraded` flag is anti-correlated with the actual defect.** It fired on 21 pages that were healthy, and did **not** fire on either genuinely broken page: `splitba:0` logged `[41 blocks, 0 interpolated]` and `merged:20` logged `[61 blocks, 2 interpolated]`, both clean. `INTERPOLATION_ALARM_SHARE = 0.5` (`gemini-ocr.ts:312`) is measuring the wrong quantity. A warning that fires on 72% of pages and stays silent on both bad ones is not a guard; it is noise that will train the next reader to skip the line.

**A second, distinct defect is present and unmeasured: granularity collapse.** `merged:20` returned 61 blocks that grouped into **21 lines**, with individual "lines" 3.1x to 6.8x median height carrying 179-448 characters, all tagged `origin: "measured"` because the text arrived space-joined with no newline for `printedSegments` to split on. Tesseract read the same page as 47 lines. Text volume was fine; only the line numbering collapsed -- and every gate rule, every slot proposal and every stored citation is denominated in those line numbers. `merged:20` is KB/ToP(2)'s page. This is not the cause of that failure (tesseract fails it too), but it is a live hazard that nothing currently counts.

---

## 3. Ordered task list

Cheapest first. **One change per gate run**, per Task 7's own rule.

### 7a. Make the two hidden defects visible. No model calls, no new spend.
**Changes:** `C:\Coding_Projects\telkom-2026\tv-helper\src\lib\pipeline\gemini-ocr.ts` and `C:\Coding_Projects\telkom-2026\tv-helper\scripts\measure-locate.mjs`.

- Add two `OcrReport` reasons, both computable from the reply alone (no pixels, so `linesFromGeminiReply(reply, width, height)` stays pure and Task 3's fixture suite stays offline):
  - **collapsed block**: an entry whose box height exceeds about 2x the page's median line height while its text carries a single printed segment. Measured: 6 such on `splitba:0`, 10 on `merged:20`, 0-1 on healthy pages.
  - **thin page**: transcribed characters per unit of returned box area falling far below the page's own median. This is the pure proxy for the paragraph-collapse mode.
- Retune or replace the interpolation alarm so it stops firing on 21 of 29 healthy pages. Report the interpolated share as a printed number, not as `degraded`.
- Reword the FAIL string at `measure-locate.mjs:1244-1245`. Delete the parenthetical **"(OCR-quality issue, not necessarily a locate failure)"** and state the measured fact instead: *"the chosen page's OCR text is N% of this crop's own reading, so no window can match -- the page transcription is incomplete."* Spec Task 6 predicted this string would hide the thing being measured, and it did exactly that for three separate readers before four investigations were spent on it.
- Print per-page transcribed characters and returned-box vertical coverage in the OCR section of the run log.

**Proves it worked:** re-run `OCR_ENGINE=gemini pnpm measure:locate` **with the caches in place**. The OCR caches are populated and the model-reply cache keys on `sha256(prompt)` over unchanged listings, so this costs approximately zero model calls. The total must still print 9/12 (nothing about the pipeline changed), the two FAIL lines must now name page incompleteness, and `splitba:0` and `merged:20` must be flagged where they previously were not.

### 7b. The completeness guard, with retry. One change. Then re-run the gate for real.
**Changes:** `gemini-ocr.ts` (the assertion and its report field), `scripts\generate.mjs`, `scripts\measure-locate.mjs`, and later `src\lib\browser\pipeline.worker.ts`.

Assert page completeness where the pixels already exist. `render.ts` hands every caller an RGBA page before `pageToPng` encodes it, so a one-pass row-luminance profile giving "the y of the last ink row" is available in all three callers without a decoder. Compare it against the lowest returned box bottom. **Measured separation on this bundle: 0.539 for the truncated page against 0.985-1.016 for the other 28.** Retry on failure; after retries exhaust, fail loudly (never a silent thin page, per the spec's own no-200-with-zero-lines rule).

State the two things that make this acceptable where the §8.1 profiler is not: **it never supplies a coordinate** (it is an assertion, not a second segmentation engine), and **its failure direction is a wasted retry, not a wrong crop.** It is still one constant calibrated on one bundle, and its comment must say so.

`/api/ocr` does not need pixels and must not get them -- the check belongs on the device, which already holds the RGBA and can re-request a page. Spec ruling 8.5 survives intact.

**Proves it worked:** delete both `measure-locate` OCR caches by hand, run `OCR_ENGINE=gemini pnpm measure:locate`. Required: 29/29 pages pass the completeness assertion after retries; per-page coverage all above the threshold; containment back to **11/12 with KB/ToP(2) as the only miss**; page selection 12/12. The guard firing and recovering is a *good* result and should be logged with a count -- zero firings means the guard is untested, not unnecessary.

### 7c. Only if 7b comes back clean and a verdict still moves: the granularity question.
Do **not** bundle this with 7b. `merged:20` returning 21 lines where tesseract found 47 is real, but spec ruling 8.2 chose the `groupWordsIntoLines` same-row merge deliberately to protect the calibrated constants, and unpicking it changes what every one of them measures. It is a separate, separately-measured change (an x-gap guard that refuses to merge across a wide gutter is the cheapest form), and it belongs after Task 8, not inside Task 7.

### Not in Task 7 at all
Task 8's constant re-derivation, `CROP_OCR_UPSCALE`, `PASS_THRESHOLD`, the OCR prompt, DPI, page tiling. See §6.

---

## 4. What the gate must show before tesseract can be deleted (Task 12)

Deleting tesseract removes the only independent second reader in the tree, and it is the step this project cannot cheaply un-take a judgement with. **Parity is required, and parity means more than the total.**

1. **Page selection: 12/12. Non-negotiable.** It is the coarse signal that the semantic step is intact, and it did not regress even in the bad run. Anything below it means the migration broke what the design turns on.
2. **Containment: 11/12, and the failure set must be a subset of the baseline's.** Not "11/12 by any route". A different 11/12 -- a new miss with ToP(2) accidentally passing -- is a different pipeline that happens to score the same number, and would be exactly the change that looks equal and is worse. A lower number is acceptable only with a written, measured argument in the harness of the kind ToP(2) already carries, showing production never asks that question. No such argument exists today for any other slot.
3. **Zero unguarded incomplete pages across 29.** The completeness assertion must be armed, and the run log must show either zero firings or firings that recovered. This is the new requirement the baseline never had to meet, and it is the one that matters, because an intermittent silent under-read at roughly 5-7% of page reads gives a 29-page bundle better than a coin's chance of containing one.
4. **Two consecutive clean gate runs, not one.** The defect is intermittent. One clean run is consistent with a 5% rate. This is the cheapest insurance available against declaring a stochastic defect fixed.
5. **Tasks 9, 10 and 11 green, plus spec §9's human review**: a person looking at all twelve crops from a full `OCR_ENGINE=gemini pnpm generate`, side by side with the tesseract run's. The gate scores containment; it does not look at a picture.
6. Deletion follows §5's ordering exactly, `public/tesseract` off disk **before** `.gitignore`.

The one thing I will not require, because it would be a bar nothing has ever met here: a second bundle. Spec §9.2 is right that it is the largest unmeasured axis, and it should be recorded as an open risk on the Task 12 commit rather than used to block a migration whose fallback is a `git revert`.

---

## 5. The footer margins

**`MAX_FOOTER_LINES` headroom degrading from 2 lines to 1 is not a problem now, and it is not the silent regression Task 7 told you to watch for.**

Read the direction of failure at `src\lib\pipeline\locate.ts:106`: over the cap, `trimRunningFooter` **declines and hands the range back untouched** -- "a few lines too many beats cutting the block short." A cap that is too small therefore produces a mildly inflated crop, never a truncated one. The expensive direction is a cap that is too *large*, and that direction got safer, not tighter.

The change is also explicable rather than random: `merged p22` went from 17 lines to 18, and its footer resolved from 1 line to 3, because Gemini reads an initialling strip and a page number as three separate lines where tesseract read one. That is finer, more accurate granularity on the footer, and the constant's own comment ("a running footer in this bundle is one or two OCR lines") is now simply out of date. It is Task 8's business to rewrite it.

**The improvement in the other margin is the one not to bank.** `FOOTER_GAP_MULTIPLE`'s headroom rose from 1.9x to 3.3x only because the largest gap inside any human crop fell from 8.5x to 4.9x of line pitch. That ratio has line pitch in its denominator, and line pitch is exactly what the granularity collapse inflates: a page read as 21 lines instead of 47 has roughly double the median pitch, which halves every gap expressed in pitch units. Some of that 8.5x to 4.9x is real (better footer resolution), and some of it is a measurement artifact of coarser lines on the collapsed pages. **Neither margin should be re-derived from this run**, whose bundle contained two defective page reads and one collapsed page. Task 8 re-derives both from a clean run, and turns the printed warning into a failure at that point -- not before, because asserting a threshold against a contaminated distribution bakes the contamination in.

---

## 6. What I would not do

**I would not exempt whole-document slots from the required-range check.** This is the single most tempting change available: it converts BA Permintaan's FAIL to a PASS, takes the total to 10/12, and looks principled because whole-document slots are *already* exempt from the two overshoot caps at `measure-locate.mjs:1276`. It is wrong. The overshoot caps are exempted because they measure localization, which a whole-page capture is not doing. Containment measures whether the page's own text can be found in the page's own reading, which is meaningful for every slot type, and it is the only check that caught a page coming back a third short. Exempting it would delete the one signal that worked.

**I would not loosen the 25% tolerance in `findRequiredLineRange`.** On healthy pages it matches to within 0-5 characters against a tolerance of 282-424 -- roughly 80x headroom. There is nothing to tune. Every character of the two failing distances was missing text.

**I would not build the ink-projection profiler.** Neither of Task 7's stated trigger conditions is met: extent inflation moved in both directions and within noise (2.58x to 2.39x, 1.53x to 1.75x, 1.05x to 1.03x), and the footer-gap margin improved. It was prototyped against tesseract's own glyph boxes -- a ground truth that runs in the profiler's favour -- and it still lost the p99 and the maximum while winning a median that the 12px pad already absorbs. It would not move the line numbering, which is what the model actually answers with, and it cannot touch a text-recall failure at all.

**I would not touch `CROP_OCR_UPSCALE`, the OCR prompt, the locate prompt, any slot hint, `PASS_THRESHOLD`, or the DPI in this run.** All four were probed: upscale 1 recovers zero points and regresses the smallest signature crop, prompt rewording recovers zero under the active `responseSchema`, 400 DPI recovers zero and measured worse on one page while halving `/api/ocr`'s 8MB headroom. Beyond being ineffective, changing the crop upscale moves the *ground truth*, which makes the run incomparable to both the tesseract baseline and to itself.

**I would not tile pages as the first fix.** It works -- the truncated page recovers to full text -- but it costs the same 2x as a detect-and-retry while adding a seam, a y-remap and de-duplication code. Keep it named as the fallback if 7b's retry turns out not to recover a truncated page in the wild, which is genuinely untested.

**I would not keep tesseract "for geometry only".** It cannot recover either point: on `merged:19` the boxes were fine and the text stopped at 51%. Substituting boxes leaves the page still untranscribed, at the price of reinstating every coupling Task 12 exists to remove.

**I would not run Task 11 (parallel ingest) before the guard lands.** It does not change the per-page defect rate, but it changes per-page failure handling on an append-only page array, and shipping it on top of an undiagnosed intermittent OCR fault mixes two sources of a wrong `Zone.pageIndex`.

**And I would not let the record say 11/12.** The run of 2026-09-02 scored 9/12 on Gemini against a fresh 11/12 tesseract baseline, and the reason it did is now known and named. Write both numbers down, labelled by engine, with the defect described. If the next run comes back 11/12, that is the number that replaces it -- earned by a re-run, not by argument.