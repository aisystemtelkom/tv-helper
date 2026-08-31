# DOKUMEN VALIDASI generator: design

Date: 2026-08-30
Status: approved, implemented in part, **superseded in part**.

> **Amended 2026-08-31.** `2026-08-31-corrections-and-document-agnostic.md` is
> authoritative wherever the two disagree. Three things below were wrong and
> are marked inline where they appear: the measurement gate's "at most 2 extra
> lines" tolerance (invented, replaced by containment), the per-order-type
> framing of the template (the slot list does not vary by order type), and the
> open question about hosting (now closed, approved). That note also adds a
> requirement this design does not cover at all, the "dokumen tambahan" loop.
> The history is left as written; only the superseded statements are annotated.

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

The sample DOKUMEN VALIDASI docx reports
`dc:title = DOKUMEN VALIDASI`, `cp:revision = 256`,
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
| Konfigurasi | 1-70000000001, Price & SA, BW, BA | filled |
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
| 13 to 16 (Konfigurasi) | screenshots of the EPIC web app on the internal network, with red rectangles drawn by hand |

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

The sample order-config xlsx is a single sheet of 35 rows
shaped `Nomor | Item I | Item II | Keterangan | value`, where Keterangan is one
of `Isi`, `Pilih`, or `Klik`. It tells an operator what to type into EPIC and in
what order.

Roughly 60 percent of its values are traceable to the two PDFs: the service
address, bandwidth, VRF name, project name, and the PIC phone numbers that
appear in the email. The rest exist only in EPIC or in a mapping tool, notably
the Customer Account, the Billing Account, the Sales Team codes, and the
LatLong pair. (Their real values are deliberately not reproduced here: this
repo is public, and an account number tied to a named customer is client
material by the same standard that keeps their documents out of it.)

## Scope for v1

**In scope.** The eleven slots sourced from the two PDFs. The xlsx with column E
filled only where a PDF backs the value. Deployment to Cloud Run with Google
sign-in and an admin-editable allowlist, as specified under Deployment and auth.

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

> **Amended 2026-08-31: the per-order-type framing above is wrong.** See
> `2026-08-31-corrections-and-document-agnostic.md` §1 and §2. `JENIS ORDER`
> values are workflow verbs, not document variants: AO is Activation Order, MO
> is Modify Order, DO is Delete Order, and more exist. **The slot list does not
> vary by order type.** The tool is document-agnostic and looks for the same
> slots in whatever documents are supplied, so "add order types without a code
> change" is answering a question that turned out not to be the shape of the
> problem. Expressing the template as data is still right; a per-order-type
> template list is not what it buys. The corollary is stronger than it sounds:
> narrowing a field's search pool by `DocType` must become an ordering hint
> rather than a hard filter, and the disambiguation has to move into each
> slot's `hint`.

**The AO default transcribes the sample exactly.** Its section list, row labels,
and ordering are copied from the sample DOKUMEN VALIDASI docx as it stands, including
the sections that arrive empty (MOM, BA Splitting, SBR Pricing, BASO, BA
Penjelasan Order) and the two-part KB table split. A first run on that bundle
should reproduce that document's skeleton with nothing added and nothing
dropped. Config-driven describes how it is stored, not licence to redesign the
form.

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

Patching a fixture would give exact Word fidelity, but the sample is full of the
customer's data and this project's rule keeps real client documents out of the
repo. A scrubbed blank fixture would solve that and reintroduce the drift
problem, because the fixture and the config would both describe the slot list.
Generating keeps one source of truth. The document is structurally simple: a
header, some headings, and two-column tables.

**Advisory check, run 2026-08-30.** `npm audit` over `docx@9.7.1` (MIT),
`tesseract.js@7.0.0` (Apache-2.0), and `@google-cloud/firestore@9.0.0`
(Apache-2.0) reports zero vulnerabilities at every severity. Given what SheetJS
taught this project, that check is a precondition rather than a formality, and
it should be re-run before each of these is bumped.

**The header table is text, not crops, and needs its own sourcing.** Its six
fields come from three different places, and the operator confirms all six on
one form before export:

| Field | Sample value | Source |
| --- | --- | --- |
| ID EPIC | `LOP999001` | source file names, `LOP\d+` |
| QUOTE | `1-70000000001` | source file names, and the EPIC screenshots when present |
| CC | `BANK CONTOH NUSANTARA` | extracted from BA Permintaan, `Nama Pelanggan` |
| NAMA Proyek | `PSB VPN IP KCP Contoh` | composed from BA Permintaan `Tipe Permintaan` and `Nama Lokasi` |
| JENIS ORDER | `AO` | operator picks, and it selects the template |
| ORDER | empty in the sample | operator, left blank by default |

The file-name derivations are heuristics and are presented as prefilled guesses,
never as settled values.

### xlsx

`exceljs`, already a dependency and already mandated over SheetJS. Thirty-five
rows from config. Column E filled only where a PDF backs the value, each filled
cell carrying a comment naming the page and line range. Unbacked rows stay
visibly blank rather than guessed at.

## Deployment and auth

Target is Google Cloud, chosen by the user, with cost efficiency as the stated
priority. The design below is built so that idle costs nothing.

### Compute

Cloud Run in `asia-southeast2` (Jakarta), `output: "standalone"` plus a
Dockerfile. Cloud Run is the only GCP compute that bills nothing while idle,
which is the normal state of an internal tool used by a handful of operators.
Jakarta is also the region that disposes of any data residency question rather
than leaving it open for a state telco.

The service runs `--allow-unauthenticated` at the IAM layer, because operators
signing in with ordinary gmail accounts cannot present IAM tokens. All gating is
app-level. This is the correct trade here, not a shortcut.

### Identity

Auth.js with Google as the only provider and the OAuth exchange performed
server-side. Sessions are signed JWTs, so there is no session store.

Server-side OAuth is a deliberate choice over Firebase Auth's client SDK, which
would put `identitytoolkit.googleapis.com` into the page's request path and
break the `performance.getEntriesByType("resource")` check that this project
treats as standing proof the browser talks to nothing but this app. With the
server-side flow the only external hop is a top-level redirect during login, not
a resource request on the working page.

Operators use ordinary gmail accounts, so domain restriction is impossible and
an explicit allowlist is load-bearing rather than optional.

### The allowlist, the only thing persisted server-side

One Firestore collection in the default database. Document id is the email;
fields record role, who added it, and when. A login costs one read against a
free-tier allowance of 50,000 reads per day.

`aisystemtelkom@gmail.com` is hardcoded as the bootstrap owner and is admitted
**even when Firestore is empty or unreachable**. Without that, an empty
collection or a mis-scoped IAM binding locks the owner out of the very admin
page that would fix it, and the only way back in is a redeploy.

**Revocation lag is a real property and is handled explicitly.** JWT sessions
mean removing someone from the allowlist does not by itself end their live
session. Rather than papering over this with short expiry, the allowlist is
cached in server memory with a 60 second TTL and re-checked on every request
that matters. Revocation therefore takes effect within a minute, at a cost of
one Firestore read per minute per instance instead of one per request.

**Where that check runs is decided by Next 16, not by preference.** See the
Next 16 subsection below. The short version is that the authoritative check
lives in a helper called by each route handler and server component, not in the
proxy layer.

### What Next 16 changes about all of this

Checked against `node_modules/next/dist/docs` on 2026-08-30, as AGENTS.md
requires. Three findings change the design rather than merely the syntax.

**`middleware.ts` is deprecated and renamed to `proxy.ts`.** The exported
function is `proxy`, and a codemod exists:
`npx @next/codemod@canary middleware-to-proxy .`. Proxy defaults to the Node.js
runtime in v16, and setting the `runtime` config option there throws, so the
Firestore SDK can run in it even though it should not.

**Proxy must not be the authorization boundary.** The Next 16 reference states
it directly: a matcher change or a refactor that moves a Server Function to a
different route can silently remove proxy coverage, so authentication and
authorization must be verified inside each Server Function rather than relying
on proxy alone. The allowlist check therefore lives in
`src/lib/auth/require-user.ts`, called by every route handler and server
component that touches a run. Proxy does only the cheap unauthenticated
redirect, and is an optimization, never the gate.

**The in-memory cache cannot live in proxy.** The same reference warns that
proxy is invoked separately from render code, in optimized cases deployed to a
CDN, and that it must not rely on shared modules or globals. A module-level
cache there would be unreliable or simply absent. The 60 second cache therefore
belongs to `require-user.ts`, which runs in the ordinary server runtime where
module state is real.

**Proxy needs a negative matcher.** Without one it runs on every request
including `_next/static`, `_next/image`, and everything in `public/`, which
would put an auth redirect in front of the CSS and, here, in front of the
self-hosted OCR assets.

### Cost inventory

| Piece | Purpose | Expected cost |
| --- | --- | --- |
| Cloud Run, asia-southeast2 | the app, scaling to zero | within free tier |
| Artifact Registry | container image, about 400MB | about $0.05/month |
| Firestore, default database | the allowlist, nothing else | free tier |
| Secret Manager | Gemini key, `AUTH_SECRET`, OAuth client secret | free at three secrets |
| IndexedDB, in the browser | every document, crop, and run | free |

Keeping documents in IndexedDB rather than Cloud Storage is the single largest
cost avoidance in this design. There is no bucket, no egress on 13MB PDFs, and
no lifecycle policy to maintain.

**Two options deliberately rejected on cost.** Cloud SQL is roughly $9 a month
and never scales to zero. Identity-Aware Proxy requires a load balancer at
roughly $18 a month. Both are the obvious-looking answers to "database" and
"auth" respectively, and both cost more than everything else here combined.

The tesseract wasm and `ind.traineddata` assets, roughly 15 to 20MB, ship inside
the container and are served with immutable cache headers so each browser
downloads them once.

### Setup gotchas for the runbook

- **The OAuth redirect URI is circular.** The OAuth client cannot be created
  until the Cloud Run URL exists, and the app cannot authenticate until the
  client exists. Deploy once with auth disabled to mint the URL, create the
  client against it, then redeploy. This looks like a broken deploy the first
  time it is encountered.
- **The consent screen must be External.** Testing mode caps at 100 users and
  expires refresh tokens after seven days. Basic email and profile scopes should
  not require Google verification to publish to Production, but confirm that
  during setup rather than discovering it when an operator is locked out
  mid-week.
- **The standalone build does not copy `public/` or `.next/static`.** Next's own
  output docs say so, and the Dockerfile must copy both into
  `.next/standalone/` explicitly. Forget it and the self-hosted tesseract wasm
  and `ind.traineddata` return 404 in production while working perfectly in
  `next dev`, which is the worst possible failure shape.
- Secrets are mounted from Secret Manager, never baked into the image or set as
  plain Cloud Run environment variables.
- Firestore is reached through the service account and Application Default
  Credentials, with the Cloud Datastore User role. No key file is downloaded.

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

> **Amended 2026-08-31: the "no more than two lines" tolerance was invented and
> is wrong.** See `2026-08-31-corrections-and-document-agnostic.md` §3. It was
> written here with no data behind it and then applied as though it were a
> requirement. Cross-checked against the sample, the twelve human-authored
> crops range from **2 lines to 43**, so a fixed +2 allowance is a 100%
> overshoot budget on the smallest crop and 5% on the largest: it measures
> nothing consistent, and it is what failed `KB / Para Pihak` (+4) and
> `KB / TTD Pejabat` (+7) even though both proposals contained every required
> line.
>
> **The rule from now on.** A proposal passes when it lands on an accepted page
> and its line range contains every line of the ground-truth crop. Overshoot is
> capped proportionally, not absolutely: reject a range more than twice the
> required line count, or one that runs the full page when the crop does not.
> That catches a genuine runaway while matching how a person actually crops.
>
> Under containment the recorded gate result is **11/12**, not the 9/12 the
> older rule produced, with page selection at **12/12**. The one genuine miss,
> `KB / ToP (2)`, stays a miss. Anyone reading a total out of
> `scripts/measure-locate.mjs` should first check which of the two rules it is
> applying.

- If nine or more of the eleven pass, the design holds and the UI is worth
  building.
- If not, we learn it for the price of a script rather than after the app is
  finished, and the direct-box approach or a different split becomes the answer.

> **Also amended 2026-08-31: it is twelve crops, not eleven.** `SP` and
> `KB / ToP` each supply two crops on two *different* pages, so each needs its
> own `locateSlot` call. The threshold above should be read proportionally
> against twelve. The Results section below already scores all twelve.

Recording the per-slot result matters as much as the verdict. A failure
concentrated in one document type is a prompt problem; failures scattered across
all eleven are an approach problem, and they call for different responses.

### Results (Task 7, run 2026-08-31)

`pnpm measure:locate` was run against the real bundle with `gemini-3.5-flash`
(`GEMINI_THINKING_LEVEL=low`). Full per-slot output, exact commands, and
detailed failure analysis are in
`.superpowers/sdd/2026-08-30-pipeline-headless/task-7-report.md` (gitignored,
not committed). Summary:

- **Count correction.** Direct inspection of the docx (`word/media/*.png`
  against the design's own provenance table) puts PDF-sourced crops at
  **twelve**, not eleven: SP and KB's ToP each supply two crops on two
  *different* pages, so each needs its own `locateSlot` call. The harness
  scores all twelve and says so in its own output.
- **Raw script score: 2 / 12 passed** (`KB / Nomor`, `KB / Tanggal`).
  Mechanically below the 9-of-11 (or proportionally ~10-of-12) bar.
- **Important scoring caveat, not a rule change.** Manual inspection of the
  OCR lines behind each "FAIL" shows most are an artifact of this harness's
  single-short-phrase-per-slot ground truth (matching the brief's own worked
  examples) being too narrow a proxy for crops that are actually whole
  paragraphs, tables, or pages -- not that the model's answer was wrong. Six
  of the ten failing slots have a plausible or good underlying answer once
  read against the actual crop content; two (`SP / Isi Surat`, `SP / TTD`)
  are unambiguous locate defects; the other two (`BA Permintaan`, `KB / Para
  Pihak`) are defensible-but-real misses. The scoring code itself was left
  as originally written and was not re-tuned to raise the number -- see the
  task-7 report for the full per-slot trace.
- **Cluster, once separated from the scoring artifact.** The two clean
  defects both belong to the SP slot, whose page pool (`[23,24,25,26]`) is
  the only one offered to the model that is non-contiguous and does not
  start at 0. Every KB call (pool `[0..22]`, contiguous, zero-based) and both
  SPLITBA calls (pool `[0,1]`) returned a page the model was actually
  offered; the SP calls did not (one call returned `pageIndex 22`, which was
  never in the offered pool, and the other landed on the wrong SP page with
  body-letter text instead of a signature). This points at the prompt/pool
  construction for non-contiguous ranges, not at the OCR-anchor approach
  itself.

Decision on whether Task 8 proceeds is deferred to the task owner; not made
by this run.

> **Superseded 2026-08-31 by two later changes. Read the numbers above as the
> record of that run, not as the current standing.** First, the whole-page
> slots were routed around the model entirely: a `layout: "images"` section is
> a full-page capture, so asking the model to find a page inside that page was
> a category error, and it returned a plausible-looking fragment every time.
> Second, the pass rule became containment (see the amendment under
> "Measurement gate" above). The standing result is **page selection 12/12,
> extent 11/12 by containment**, with `KB / ToP (2)` the one genuine miss.
> Task 8 did proceed; the pipeline through export is built and merged.

## Constraints preserved

- Inference is the only thing that leaves the machine, and under this design it
  leaves as text rather than images.
- Sessions persist to IndexedDB. Document conversion stays in the browser.
- The API key stays server-side only, read in `src/lib/model.ts`, which remains
  the only file that knows how the model is reached.
- Real client documents stay out of the repo.
- Everything must run on a teammate's Mac, so OCR is WASM rather than a native
  binary. This applies to the container build too: the image must build and run
  on arm64 as well as the amd64 that Cloud Run serves.
- The browser still talks to nothing but this app. Serving from Cloud Run moves
  the origin off localhost but adds no third party to the page, which is why
  server-side OAuth was chosen over a client-side identity SDK.

**One change of posture to record.** Hosting on Cloud Run puts the application
itself on Google infrastructure. The documents still never leave the browser, so
the substance of the constraint holds. But the client approved Google as a
processor **for inference**, and this widens that to hosting. That is the same
renegotiation that happened in 2026-08, so it needs a sentence to bidang TV 1
rather than being assumed to be covered.

> **Amended 2026-08-31: that sentence was said, and the answer is yes.** The
> client has approved hosting on Google Cloud, not only inference. See
> `2026-08-31-corrections-and-document-agnostic.md` §5. The widening is
> approved rather than assumed. Everything else in this list is unchanged: the
> documents themselves still stay on the device, and none of the other
> constraints were re-opened by that approval.

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
- **Auth stays server-side. Never swap in a client-side identity SDK.** Firebase
  Auth's browser SDK is the tempting simplification and it puts
  `identitytoolkit.googleapis.com` in the page's request path, which breaks the
  zero-external-hosts check. The seam is the same one that keeps the Gemini key
  server-side.
- **The bootstrap owner stays hardcoded and stays exempt from the Firestore
  lookup.** It reads like a smell and it is the only thing standing between an
  empty allowlist and a locked-out owner whose fix requires a redeploy.
- **No Cloud SQL, no Identity-Aware Proxy.** Both are the obvious answers to
  "we need a database" and "we need auth", both cost more per month than the
  entire rest of the deployment, and neither scales to zero.
- **Documents stay in IndexedDB.** There is deliberately no Cloud Storage
  bucket. Adding one re-opens a client constraint and adds egress on 13MB PDFs
  for no gain.
- **Proxy is not the auth boundary, and the file is `proxy.ts`.** Next 16
  renamed `middleware.ts` and states that a matcher change can silently remove
  coverage. Every route that touches a run calls `requireUser()` itself. Moving
  the gate into proxy "to avoid duplication" is the regression to watch for.

## Open questions

- ~~Whether the slot list varies by jenis order remains unconfirmed with bidang
  TV 1. The config-driven design absorbs a change without a rewrite, so this
  does not block implementation.~~ **Closed 2026-08-31: it does not vary.** The
  tool is document-agnostic and looks for the same slots in any document. AO,
  MO, and DO are Activation, Modify, and Delete Order, workflow verbs rather
  than document variants. See `2026-08-31-corrections-and-document-agnostic.md`
  §1 and §2, and the amendment under "Template configuration" above.
- OCR accuracy on Indonesian scanned contracts is unmeasured. The measurement
  gate above covers it, since bad OCR shows up as bad line ranges.
- Only two sample bundles exist. That is enough to test capture and not enough
  to claim accuracy.
- ~~Whether the client's approval of Google as a processor extends from inference
  to hosting is unconfirmed. Does not block building, does block going live.~~
  **Closed 2026-08-31: approved.** Hosting on Google Cloud is approved, not
  only inference. See `2026-08-31-corrections-and-document-agnostic.md` §5.
- Whether publishing the OAuth consent screen to Production with only email and
  profile scopes clears Google verification is unconfirmed. If it does not, the
  Testing-mode cap of 100 users and seven-day refresh tokens becomes the
  operating constraint.

**Added 2026-08-31, and not covered anywhere in this design: the "dokumen
tambahan" loop.** Slots the supplied documents cannot fill must not silently
ship empty. The flow is: search everything for every slot, report the
outstanding slots by name, ask the operator whether an additional document
exists, search only the outstanding slots in whatever arrives, and repeat until
the operator says no, at which point each remaining slot offers manual zone
selection. A run is therefore resumable and additive, and confirmed slots are
never re-searched. See `2026-08-31-corrections-and-document-agnostic.md` §4 for
why this is a correctness requirement rather than a convenience: it converts
"not found" from a silent gap into a decision the operator makes on the record.

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

src/lib/auth/config.ts         Auth.js, Google provider, signIn allowlist check
src/lib/auth/allowlist.ts      Firestore reads, 60s memory cache, bootstrap owner
src/lib/auth/require-user.ts   the authoritative gate, called per route
src/app/admin/page.tsx         allowlist management, admin role only
src/proxy.ts                   unauthenticated redirect only, with a negative
                               matcher; NOT middleware.ts, renamed in Next 16

Dockerfile                     standalone build, multi-arch
next.config.ts                 gains output: "standalone"
docs/runbook-deploy.md         the circular OAuth URI, consent screen, secrets
```

Deleted: the assistant-ui chat, `src/components/*`, and the thread history
adapters. They proved the inference path and that job is done.
