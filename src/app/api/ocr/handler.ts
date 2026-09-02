/**
 * `/api/ocr`: one rendered page image in, this pipeline's numbered `Line[]`
 * out.
 *
 * WHY IT IS A SERVER ROUTE, and what changed. Until the Gemini OCR migration
 * the browser recognised text on the device with tesseract wasm and needed no
 * credential at all. Recognition is now a model call, and `src/lib/model.ts`
 * is the only file that may know how the model is reached -- it is server-side
 * because the credential is -- so the tab renders the page and posts the
 * pixels here.
 *
 * WHAT LEAVES THE DEVICE, EXACTLY. ONE RENDERED PAGE IMAGE PER REQUEST, to
 * this app's own origin, forwarded to the Gemini API for text recognition. The
 * PDF itself still never leaves: pdf.js renders it in the tab, the run lives in
 * IndexedDB, and every crop is cut from the device's own pixels. That is a
 * narrower claim than the one this project shipped with, and it is the client's
 * decision of 2026-09-02, taken after their own due diligence on Google. The
 * privacy page (`src/app/privacy/page.tsx`) says the same thing in two
 * languages, and it ships in the same commit as this route: a dated privacy
 * policy that describes the previous architecture is worse than none.
 *
 * The control flow is separated from `route.ts` for the same reason
 * `/api/propose` and `/api/chat` separate theirs: so `ocr.test.mts` can execute
 * the authorization gate and every validation rule with no Next runtime, no
 * bundler and no credential. `route.ts` is the production binding and nothing
 * else.
 *
 * ## The order below is the point
 *
 * Gate first and unconditionally, then validate the body, then spend. Moving
 * the gate after either step would still answer an anonymous caller 401 while
 * letting them spend the credential first.
 *
 * ## Never a 200 carrying zero lines
 *
 * `/api/propose` earned its `AskFailed` distinction the hard way: a missing
 * credential once returned 200 with every slot "outstanding", which reads as
 * SEARCHED AND NOT FOUND. The OCR version of that mistake is worse. A page is
 * appended to `BrowserRun.pages` permanently -- the array is append-only
 * because `Zone.pageIndex` is a position in it, and there is no single-page
 * re-OCR path -- so a page that arrives with no lines is a blank scan for the
 * life of the run, every slot then legitimately reports not-found, and nothing
 * anywhere looks wrong.
 *
 * So there are three distinct failures here and they get three distinct
 * statuses:
 *
 *   503  the model was never reached. "Nothing in your run has been changed."
 *   502  the model answered and the answer is unusable (truncated, unparseable,
 *        wrong coordinate convention, or no lines at all).
 *   400/413  the caller sent something that is not a page image.
 */

import type { ApiGate } from "@/lib/auth/guard";

// Relative, with explicit `.ts`, and never through the `@/` alias: this file is
// executed directly by `node --test` (see the note above), which resolves
// neither a bare alias nor an extensionless specifier. The `@/` import above
// survives only because it is type-only and therefore erased.
import type { Line } from "../../../lib/pipeline/geometry.ts";
import {
  pngDimensions,
  type OcrReport,
} from "../../../lib/pipeline/gemini-ocr.ts";

/**
 * The recognition step, injected.
 *
 * It takes the PNG bytes and NOTHING ELSE -- no width, no height, no DPI. The
 * dimensions the boxes are scaled against are read from the image's own IHDR,
 * so there is exactly one source of truth for the coordinate space and no way
 * for a caller to claim dimensions the pixels do not have. OCR measured against
 * one set of dimensions and a crop cut from a re-render at another is the
 * scariest silent failure in this design: every box would be finite, on-page,
 * plausibly placed, and wrong.
 */
export type OcrDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model call plus the conversion. Only reached once `gate` admits. */
  recognize: (png: Uint8Array) => Promise<{ lines: Line[]; report: OcrReport }>;
  /** Turns "the model could not be reached" into an operator-readable 503. */
  unreachable: (error: unknown) => Response;
};

export type OcrResult = {
  width: number;
  height: number;
  lines: Line[];
  report: OcrReport;
};

/**
 * A ceiling on one page, not a budget.
 *
 * A 300 DPI A4 page measured 2.24-2.32MB as PNG, so 8MB is roughly triple the
 * real case and still far under Cloud Run's 32 MiB HTTP/1 body cap and Gemini's
 * own 20MB inline-data cap. It exists because the body is buffered in memory
 * before anything looks at it: at `--concurrency` 80, unbounded multi-MB bodies
 * are an OOM shape, and a Cloud Run OOM kills the container along with every
 * other operator's in-flight request.
 */
export const MAX_PNG_BYTES = 8 * 1024 * 1024;

/**
 * "The model answered, and the answer cannot be used."
 *
 * Kept distinct from every other throw for the reason the file header gives:
 * an unreachable model is a 503 that promises the run is unchanged, and this
 * is a 502 that says the reply itself was rejected. `route.ts` throws it for a
 * `finishReason` that is not `"stop"`, for a reply that will not parse, and for
 * a reply whose boxes are in the wrong coordinate convention -- all three of
 * which `linesFromGeminiReply` refuses loudly rather than returning a thin
 * page.
 */
export class OcrUnusable extends Error {
  // An explicit field, NOT a TypeScript parameter property: this file is
  // executed by `node --test`, whose strip-only type stripping rejects
  // `constructor(readonly detail: unknown)` outright.
  detail: unknown;

  constructor(detail: unknown) {
    super(detail instanceof Error ? detail.message : String(detail));
    this.name = "OcrUnusable";
    this.detail = detail;
  }
}

function badRequest(message: string, status = 400): Response {
  return Response.json(
    {
      error: "bad-request",
      message,
      // Same promise the 503 makes, for the same reason: the operator is
      // mid-ingest and the only question that matters is whether the pages
      // already committed are still trustworthy.
      hint: "Nothing in your run has been changed.",
    },
    { status },
  );
}

function unusable(reason: string, cause?: unknown): Response {
  return Response.json(
    {
      error: "unusable-reply",
      message:
        `The model answered but the reply could not be used: ${reason}. ` +
        "Nothing in your run has been changed. Try the ingest again; if it " +
        "keeps happening, the page may need a different resolution or the " +
        "OCR prompt may need a look.",
      cause: cause instanceof Error ? cause.message : cause,
    },
    { status: 502 },
  );
}

/** PNG's 8-byte signature. `pngDimensions` re-checks it; see `readPng`. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Everything that can be decided about the body before a token is spent.
 *
 * Returns the bytes and the dimensions, or the Response to send instead. The
 * dimension read is deliberately done HERE as well as inside `recognize`: it
 * is the cheapest possible proof that the caller sent a page image and not,
 * say, an HTML error document from an intercepting proxy, and it costs a
 * 24-byte header read.
 */
async function readPng(
  req: Request,
): Promise<{ bytes: Uint8Array; width: number; height: number } | Response> {
  // The declared length first, so an oversized upload is refused before it is
  // buffered. Not trusted -- a caller can lie or omit it -- which is why the
  // real length is checked again below.
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_PNG_BYTES) {
    return badRequest(
      `That page is ${declared} bytes; the limit is ${MAX_PNG_BYTES}. A 300 DPI ` +
        "A4 page is about 2.3MB as PNG, so this is not one.",
      413,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch (error) {
    return badRequest(
      `the request body could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (bytes.byteLength > MAX_PNG_BYTES) {
    return badRequest(
      `That page is ${bytes.byteLength} bytes; the limit is ${MAX_PNG_BYTES}.`,
      413,
    );
  }
  if (bytes.byteLength === 0) {
    return badRequest("the request body is empty; POST the raw PNG as the body");
  }
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    return badRequest(
      "the request body is not a PNG. This route takes the raw image as the " +
        "body with `content-type: image/png` -- no JSON, no base64 (a 33% tax " +
        "on a 2.3MB page), no multipart, and no metadata.",
    );
  }

  try {
    const { width, height } = pngDimensions(bytes);
    return { bytes, width, height };
  } catch (error) {
    return badRequest(
      `the PNG header could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function createOcrHandler(deps: OcrDeps) {
  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself. `proxy.ts`
    //    would also refuse an anonymous caller, but proxy is an optimization
    //    and not the boundary -- see the note at the top of that file.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read and validate what the caller sent.
    const png = await readPng(req);
    if (png instanceof Response) return png;

    // 3. Only then spend the credential.
    let result: { lines: Line[]; report: OcrReport };
    try {
      result = await deps.recognize(png.bytes);
    } catch (error) {
      // A reply that arrived and cannot be used is the caller's problem to
      // retry, not evidence that the model is down. Everything else -- a
      // missing credential, quota, a 503 storm that outlasted the retries --
      // is reported as unreachable, which is the response that promises the
      // committed pages are untouched.
      if (error instanceof OcrUnusable) {
        return unusable("see cause", error.detail);
      }
      return deps.unreachable(error);
    }

    // 4. NEVER A 200 WITH ZERO LINES. See the file header: an empty page is
    //    appended permanently, reads downstream as a blank scan, and makes
    //    every slot legitimately outstanding. A genuinely blank sheet in a
    //    bundle hits this too, and failing loudly on one is the right trade
    //    against silently mis-recording a page that had text on it.
    if (result.lines.length === 0) {
      return unusable(
        "it contained no text lines at all, and a page with no lines cannot be " +
          "told apart from a page that was never read",
        result.report.reasons.join("; ") || undefined,
      );
    }

    // The dimensions are the ones read from this image's own IHDR, and the
    // client asserts them against its own `RenderedPage` before it stores a
    // single line. That assertion is what catches OCR measured at one DPI and
    // a crop cut at another.
    const body: OcrResult = {
      width: png.width,
      height: png.height,
      lines: result.lines,
      report: result.report,
    };
    return Response.json(body);
  };
}
