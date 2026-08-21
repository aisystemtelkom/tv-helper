# tv-helper

Local Gemma 3 inference with an [assistant-ui](https://assistant-ui.com) chat
front end.

The chat UI is **scaffolding, not the product**. It exists to prove that local
inference works end to end. The real target is a scanned-document validator,
which is why the model, the context budget, and the smoke tests are all chosen
around a vision-capable model rather than the smallest one that can hold a
conversation.

## Requirements

- Node 20+ and pnpm
- [Ollama](https://ollama.com/download) — a system binary, the one step `git
  clone` cannot do for you:
  - Windows: `winget install --id Ollama.Ollama -e`
  - macOS: `brew install ollama`
  - Linux: `curl -fsSL https://ollama.com/install.sh | sh`
- ~4 GB of disk for the weights, and a GPU with ~6 GB free VRAM (or patience —
  it falls back to CPU)

## Getting started

```bash
pnpm install
pnpm model:pull          # pulls gemma3:4b (3.3 GB) into ./models
pnpm ollama:serve   # terminal 1 — the model server
pnpm smoke          # terminal 2 — proves inference works, no UI involved
pnpm test           # attachment converter tests (no model needed)
pnpm dev            # terminal 2 — then open http://localhost:3000
```

`pnpm smoke` is the honest test. If it passes, inference works; if the browser
then misbehaves, the bug is in the web layer, not the model.

## Sessions

Multiple chat sessions, ChatGPT style: a sidebar with new / search / rename /
archive / delete, auto-titled from the first message. Everything persists to
**IndexedDB**, which is browser-native and on-device -- no server, no network,
no third party.

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
| Images | sent as-is | Gemma 3's vision tower reads these natively |
| `.txt` `.csv` `.md` `.json` | sent as text | the provider decodes text parts |
| **PDF** | pages rasterized to PNG | Ollama rejects PDF parts outright |
| **`.xlsx`** | CSV text (exceljs) | a vision model cannot open a spreadsheet |
| **`.docx`** | plain text (mammoth) | same |

Anything else is refused at attach time instead of failing after send.

**PDFs cap at 5 pages** (`DEFAULT_PAGE_LIMIT` in `src/lib/attachments/pdf.ts`).
Gemma 3 spends ~256 tokens per image against an 8192-token context, so a long
document would exhaust the window before the question was read. When a PDF is
truncated the prompt says so, rather than letting the model answer about pages
it never saw.

Two deliberate choices worth keeping:

- **`exceljs`, not `xlsx`.** SheetJS on npm is frozen at 0.18.5 with two
  unpatched HIGH advisories (prototype pollution, ReDoS) whose fixes ship only
  from the vendor's own CDN. We parse untrusted user files, which is exactly
  that threat model.
- **The pdf.js worker is bundled, not fetched from a CDN.** The default
  `workerSrc` points at a CDN, which would put a third party in the request path
  of a local-only app and break offline use. Verified: the running page makes
  zero external requests.

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
                         OpenAI-compatible HTTP   src/lib/model.ts
                                |
                                v
                   Ollama :11435  ->  gemma3:4b  ->  ./models
```

**The boundary at `src/lib/model.ts` is the point of the design.** The app
speaks nothing but the OpenAI chat-completions wire format, so replacing Ollama
with llama.cpp, vLLM, or a hosted endpoint is an env var change rather than a
refactor. Nothing above that file imports an Ollama SDK.

## Why these choices

**Ollama over llama.cpp.** This project has to run on both Windows/CUDA and a
teammate's Apple Silicon Mac. Ollama resolves Metal vs CUDA itself; llama.cpp
would have made us maintain a per-platform binary matrix (Blackwell `sm_120`
builds vs Metal), which is the exact cross-platform tax we wanted to avoid.

**`gemma3:4b`, not `1b`.** The `1b` and `270m` tags have no vision tower. Since
the end goal is document validation, starting text-only would mean replacing the
model later and re-testing everything.

**Port 11435, and `./models`.** A project-owned server on a non-default port
cannot be shadowed by a machine-wide Ollama install quietly serving weights from
`~/.ollama`. This is not hypothetical: on the Windows machine this was built on,
the installer auto-started a tray app on 11434 holding zero models. What this
repo runs is what this repo downloaded.

`pnpm ollama:serve` exits rather than start on an occupied port — a second
server would fail to bind while the banner still claimed your settings were
live.

## VRAM

Sized for an 8 GB laptop GPU that also has to render a desktop and a browser:

| Component | VRAM |
|---|---|
| gemma3:4b weights (Q4) | ~3.3 GB |
| SigLIP vision encoder | ~0.5–0.9 GB |
| KV cache @ 8K context | ~0.5–1 GB |
| **Total** | **~4.5–5.5 GB** |

Guards live in `scripts/env.mjs`:

- `OLLAMA_CONTEXT_LENGTH=8192` — the big one. Gemma 3 supports 128K, whose KV
  cache would not fit an 8 GB card.
- `OLLAMA_KEEP_ALIVE=5m` — idle models release their VRAM.
- `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` — roughly halve the
  KV cache.
- `OLLAMA_MAX_LOADED_MODELS=1` — never two models resident at once.

Running out of VRAM degrades to partial CPU offload — slow, not a crash. To free
the GPU immediately, stop the server or run `ollama stop gemma3:4b`.

## Measured on an RTX 5060 Laptop (8 GB)

| | |
|---|---|
| Model resident in VRAM | 2.72 GB, 100% GPU-offloaded, ctx 8192 |
| First request after load | ~74 s — weights streaming into VRAM, not a hang |
| Streaming, once warm | < 1 s to first token |

The first call after an idle period pays the load cost again, because
`OLLAMA_KEEP_ALIVE=5m` releases the VRAM. That trade is deliberate: the GPU is
free when you are not using it. Raise it if you would rather keep the model hot.

## Known limits

- **Gemma 3 4B's OCR on dense scans is mediocre.** Its vision tower is 896×896
  SigLIP with pan-and-scan tiling, so small print degrades. Before committing the
  document validator to 4B, test it on real scans; `gemma3:12b` or a dedicated
  OCR pass feeding text to Gemma may be necessary. 12B is tight on 8 GB but
  comfortable on a 32 GB Mac.
- **Gemma 3 has no native tool-calling** in its chat template. `/api/chat` only
  forwards a `tools` field when the client actually registers one.
- **Long PDFs are truncated to 5 pages**, a context-window limit rather than a
  parsing one. Raising `OLLAMA_CONTEXT_LENGTH` buys more pages at the cost of
  VRAM; measure before committing to it.
- **Sessions are per-browser-profile.** IndexedDB is scoped to the origin, so
  history does not follow you to another browser or machine.
- **Weights are not committed.** `./models` is gitignored; `pnpm model:pull` refetches.

## Layout

```
scripts/env.mjs               config + cross-platform binary resolution
scripts/server.mjs            server lifecycle (reuses a running one if present)
scripts/setup-model.mjs       pulls the model into ./models
scripts/smoke.mjs             text, streaming, and vision assertions
scripts/png.mjs               dependency-free PNG encoder for the vision probe
scripts/test-converters.mjs   xlsx/docx extraction tests (`pnpm test`)

src/lib/model.ts              the provider boundary
src/lib/storage/indexeddb.ts  AsyncStorageLike over IndexedDB
src/lib/threads/history.ts    the withFormat history adapter
src/lib/threads/store.tsx     thread list wiring
src/lib/attachments/pdf.ts    PDF pages -> PNG (self-hosted worker)
src/lib/attachments/office.ts xlsx/docx -> text
src/lib/attachments/adapter.ts  accept list + conversion at send time

src/app/api/chat/route.ts
src/app/assistant.tsx         runtime + sidebar shell
```
