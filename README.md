# tv-helper

Gemini vision inference with an [assistant-ui](https://assistant-ui.com) chat
front end.

The chat UI is **scaffolding, not the product**. It exists to prove that
inference works end to end. The real target is a scanned-document validator,
which is why the model, the page budget, and the smoke tests are all chosen
around a vision-capable model rather than the cheapest one that can hold a
conversation.

## Requirements

- Node 20+ and pnpm
- A Gemini API key from [AI Studio](https://aistudio.google.com/apikey)

That is the whole list. There is no local model server, no weights to download,
and no GPU requirement. Inference runs on the Gemini API and the app fails
loudly without a key.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then paste your key into it
pnpm smoke                   # proves inference works, no UI involved
pnpm test                    # attachment converter tests (no API calls)
pnpm dev                     # then open http://localhost:3000
```

`pnpm smoke` is the honest test. If it passes, inference works; if the browser
then misbehaves, the bug is in the web layer. It checks reachability, text,
streaming, vision, and what a scanned page costs:

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
(`src/lib/model.ts`) and are all env-tunable. Measured against
`gemini-3.5-flash`:

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

Three things worth knowing before tuning these:

- **Image tokens are a flat rate per tier, not per pixel.** A 224x224 thumbnail
  and a 1700x2200 page bill identically. Downscaling saves upload and IndexedDB
  space but not one API token, and a handful of small images costs far more than
  it looks.
- **Thought tokens bill at the output rate.** Dropping from Gemini's default of
  `medium` to `low` is the cheapest saving available and costs nothing measurable
  on field extraction. `MEDIA_RESOLUTION_HIGH` is the opposite: it is the largest
  input cost and also the setting that lets the model read small print, which is
  the entire product.
- **`GEMINI_MAX_OUTPUT_TOKENS` (default 4096) is a runaway guard, not a budget.**
  The model will otherwise emit up to 65536 tokens. If a legitimate reply is cut
  short, the server logs a warning naming the variable.

`/api/chat` logs token usage per request:

```
[chat] gemini-3.5-flash in=1101 out=178 (thoughts=177) total=1279 finish=stop
```

## Sessions

Multiple chat sessions, ChatGPT style: a sidebar with new / search / rename /
archive / delete, auto-titled from the first message. Everything persists to
**IndexedDB**, which is browser-native and on-device. Chat history is never
uploaded anywhere; only the current turn is sent to Gemini.

IndexedDB rather than localStorage because history holds base64 image data:
localStorage's ~5 MB origin cap would start throwing `QuotaExceededError` after
a handful of scanned pages. assistant-ui's storage interface is async precisely
so it can sit on IndexedDB.

One integration note for whoever touches `src/lib/threads/`: assistant-ui's
bundled `createLocalStorageAdapter` ships a history adapter **without**
`withFormat`, which `useChatRuntime` hard-requires --

```
useAISDKRuntime: ThreadHistoryAdapter is missing the required `withFormat` method.
```

So `src/lib/threads/history.ts` supplies one, and `store.tsx` patches it into
the bundled adapter rather than reimplementing the thread list. Don't "simplify"
that back to the stock adapter; messages will stop persisting.

## Attachments

The composer accepts only what this stack can actually carry, and converts in
the browser before sending:

| Attached | Becomes | Why |
|---|---|---|
| Images | sent as-is | Gemini reads these natively |
| `.txt` `.csv` `.md` `.json` | sent as text | the provider decodes text parts |
| **PDF** | pages rasterized to PNG | one code path for every attachment |
| **`.xlsx`** | CSV text (exceljs) | a vision model cannot open a spreadsheet |
| **`.docx`** | plain text (mammoth) | same |

Anything else is refused at attach time instead of failing after send.

**PDFs cap at 5 pages** (`DEFAULT_PAGE_LIMIT` in `src/lib/attachments/pdf.ts`).
This used to be a context limit; with a 1M-token context it is now a cost limit.
At ~1110 tokens per page, five pages is ~5550 input tokens per request and
raising the cap multiplies that linearly. When a PDF is truncated the prompt
says so, rather than letting the model answer about pages it never saw.

Gemini can accept PDF parts directly. Rasterizing in the browser is kept anyway,
because it keeps conversion on the client and keeps one code path for every
attachment type.

Two deliberate choices worth keeping:

- **`exceljs`, not `xlsx`.** SheetJS on npm is frozen at 0.18.5 with two
  unpatched HIGH advisories (prototype pollution, ReDoS) whose fixes ship only
  from the vendor's own CDN. We parse untrusted user files, which is exactly
  that threat model.
- **The pdf.js worker is bundled, not fetched from a CDN.** The default
  `workerSrc` points at a CDN, which would put an unapproved third party in the
  browser's request path. Verified: the running page makes zero external
  requests.

## How it fits together

```
<ThreadList/> + <Thread/>       src/app/assistant.tsx
   |                 |
   |                 |  attachments converted in-browser
   |                 |     src/lib/attachments/  (pdf, office, adapter)
   |                 v
   |          useRemoteThreadListRuntime
   |                 |
   |  IndexedDB      v
   +---------- POST /api/chat   src/app/api/chat/route.ts
      src/lib/threads/          |  streamText
      src/lib/storage/          v
                          @ai-sdk/google      src/lib/model.ts
                                |
                                v
                     Gemini API  ->  gemini-3.5-flash
```

**The boundary at `src/lib/model.ts` is the point of the design.** It is the
only file that knows the provider, the model id, the cost settings, or the
credential. Everything above it receives an AI SDK `LanguageModel`, so changing
runtimes is a change to that one file rather than a refactor.

The API call is made **server-side**, from the route handler. The browser talks
only to this app, and the key has no `NEXT_PUBLIC_` prefix so it never reaches
the client bundle.

## Why these choices

**`gemini-3.5-flash`, chosen by measurement.** Newer is not automatically
better. `gemini-3.7-flash` is a newer GA flash tag and took 99-190s on a trivial
vision call with intermittent 503 "high demand" responses, past the chat route's
120s ceiling. `gemini-3.5-flash` answers the same probe in about 2s and passed
3/3 vision runs. Re-measure with `pnpm smoke` before changing it.

**A vision model, not the cheapest chat model.** The end goal is document
validation. Starting text-only would mean replacing the model later and
re-testing everything.

**The native `@ai-sdk/google` provider, not Gemini's OpenAI compatibility
endpoint.** The compatibility shim exists for easy migration, not full fidelity:
it does not carry `thinkingConfig` or `mediaResolution`, which are the two
settings this app uses to control cost and OCR quality. `pnpm smoke` drives the
same native surface for the same reason, so it cannot pass while the app fails.

**No local fallback.** Ollama is not deployed to production, so it is not kept
as a code path either. A dead branch that nobody runs is a branch that quietly
stops working.

## Known limits

- **Cost scales with pages, not with documents.** Five pages is ~5550 input
  tokens before the question is even read. Batch carefully.
- **Small images are not cheap.** Flat-rate image billing means a 224x224
  thumbnail costs the same 1110 tokens as a full page at `HIGH`.
- **`TARGET_EDGE = 1024` in `pdf.ts` is a leftover.** It was sized for Gemma 3's
  896x896 vision tower. Since image tokens are flat-rate, raising it would cost
  upload and IndexedDB space but no extra API tokens, and might recover detail on
  dense scans. Measure on real documents before changing it.
- **OCR quality on dense scans is unverified here.** The smoke test proves the
  vision path works, not that it reads small print correctly. Test against real
  client scans before committing the validator to this model.
- **Long PDFs are truncated to 5 pages**, now a cost limit rather than a context
  one.
- **Sessions are per-browser-profile.** IndexedDB is scoped to the origin, so
  history does not follow you to another browser or machine.
- **Rate limits are the API's, not ours.** Bursts can return 503 "high demand".
  The smoke test retries once on a dropped connection and says when it did.

## Layout

```
scripts/env.mjs               config, .env loading, cost defaults
scripts/smoke.mjs             reachability, text, streaming, vision, cost
scripts/png.mjs               dependency-free PNG encoder for the vision probe
scripts/test-converters.mjs   xlsx/docx extraction tests (`pnpm test`)

src/lib/model.ts              the provider boundary: model, cost, credential
src/lib/storage/indexeddb.ts  AsyncStorageLike over IndexedDB
src/lib/threads/history.ts    the withFormat history adapter
src/lib/threads/store.tsx     thread list wiring
src/lib/attachments/pdf.ts    PDF pages -> PNG (self-hosted worker)
src/lib/attachments/office.ts xlsx/docx -> text
src/lib/attachments/adapter.ts  accept list + conversion at send time

src/app/api/chat/route.ts     streaming + per-request cost logging
src/app/assistant.tsx         runtime + sidebar shell
```
