/**
 * The only file that knows how Cloud Vision is reached.
 *
 * The counterpart of `src/lib/model.ts`, and a SEPARATE file rather than an
 * addition to it because the two providers authenticate in genuinely different
 * ways and folding them together would blur the one thing that file exists to
 * state. Gemini takes an API key from the environment. Vision does not:
 *
 *     $ curl .../v1/images:annotate?key=<a valid Google API key>
 *     401 "API keys are not supported by this API. Expected OAuth2 access
 *         token or other authentication credentials that assert a principal."
 *
 * Measured, not assumed. So this uses Application Default Credentials, which
 * is already the established pattern in this codebase -- `src/lib/auth/
 * firestore.ts` reaches Firestore the same way, with no key file downloaded
 * and nothing reading a credential itself. On Cloud Run that is the runtime
 * service account via the metadata server; locally it is
 * `gcloud auth application-default login`.
 *
 * `google-auth-library` is already a direct dependency, so this adds none.
 *
 * ## WHERE THE DATA IS PROCESSED, which is a client question and not a
 * technical detail
 *
 * Cloud Vision publishes exactly two regional endpoints, and neither is in
 * Asia. Probed directly rather than read off a page: `eu-vision.googleapis.com`
 * and `us-vision.googleapis.com` answer with a structured Vision API error,
 * which is an endpoint serving the API, while `asia-vision`,
 * `asia-southeast1-vision` and `asia-southeast2-vision` all return Google's
 * generic 404 HTML, which is no endpoint at all.
 *
 * This deployment is in `asia-southeast2` (Jakarta) deliberately, for a state
 * telco, so that is worth stating plainly rather than burying: PAGE IMAGES
 * SENT FOR RECOGNITION ARE NOT PROCESSED IN INDONESIA. The default below is
 * the global endpoint, which Google routes at its discretion; `VISION_ENDPOINT`
 * pins it to the EU or the US if the client would rather have a named region
 * than an unnamed one.
 *
 * This is not a NEW exposure -- the Gemini OCR path this replaces posts the
 * same page images to `generativelanguage.googleapis.com`, which is equally
 * not Jakarta -- but "no worse than before" is a thing to say out loud rather
 * than a reason to leave it unsaid.
 */

import { GoogleAuth } from "google-auth-library";

/**
 * Where to send recognition requests.
 *
 * The global endpoint by default. Set to `https://eu-vision.googleapis.com` or
 * `https://us-vision.googleapis.com` to pin processing to a named region; see
 * the header for why there is no Asian option to offer.
 */
export const VISION_ENDPOINT =
  process.env.VISION_ENDPOINT ?? "https://vision.googleapis.com";

/**
 * USD per page, for the cost ledger.
 *
 * $1.50 per 1,000 units, for 1,001 to 5,000,000 units a month; the first 1,000
 * units each month are free and it falls to $1.00 per 1,000 above 5M. Neither
 * of those is modelled here, and `src/lib/cost.ts` says why: a single run
 * cannot know where in a MONTH's usage it falls, so pricing every page at the
 * standard rate is the honest overestimate. A run that was actually free
 * prints a number slightly too high, which is the safe direction for a figure
 * somebody budgets against.
 */
export const VISION_PAGE_PRICE_USD = 1.5 / 1000;

/** Priced as of the same date as the token table in `src/lib/cost.ts`. */
export const VISION_PRICE_AS_OF = "2026-09-03";

/**
 * The project billed and quota-counted for a request, sent as
 * `x-goog-user-project`.
 *
 * REQUIRED FOR USER CREDENTIALS, ignored for a service account, and the
 * difference is a real trap rather than a formality. A service account
 * asserts its own project, so Cloud Run needs none of this. Local ADC from
 * `gcloud auth application-default login` is a USER credential and asserts no
 * project, and Vision refuses it outright:
 *
 *     403 "Your application is authenticating by using local Application
 *          Default Credentials. The vision.googleapis.com API requires a quota
 *          project, which is not set by default."
 *
 * Measured, on the first real run. Sending the header when a project is known
 * is correct in both cases -- harmless for the service account, necessary for
 * the developer -- which is why it is not conditioned on which one is in use.
 */
function quotaProject(): string | undefined {
  return (
    process.env.VISION_QUOTA_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    undefined
  );
}

/**
 * A ceiling on one request, not a budget.
 *
 * `fetch` has no timeout of its own, so without this a stalled connection
 * hangs an ingest silently with the operator watching a progress bar. The same
 * reason `/api/ocr` wraps its Gemini call, and the same order of magnitude:
 * recognition of a 300 DPI page is seconds, not a minute.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS ?? 60_000);

/**
 * Raised when Vision was reached and refused, or answered unusably.
 *
 * Distinct from a transport failure for the same reason `/api/ocr` separates
 * "the model could not be reached" from "the reply was unusable": one promises
 * the run is unchanged and is worth retrying, the other is a verdict about
 * this request.
 */
export class VisionUnavailable extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "VisionUnavailable";
    this.status = status;
  }
}

/**
 * Built on first request rather than at import time.
 *
 * The same reason `chatModel()` is lazy: a missing credential would otherwise
 * throw while Next collects routes and fail the BUILD instead of the request
 * that actually needs it.
 */
let auth: GoogleAuth | undefined;

function client(): GoogleAuth {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return auth;
}

/**
 * Whether a failure is worth asking again.
 *
 * Deliberately narrow, and narrower than the Gemini path's. A generative model
 * legitimately answers differently on a second identical call, so re-asking is
 * a recovery strategy there. Vision is a deterministic recogniser: an
 * INVALID_ARGUMENT or a PERMISSION_DENIED will be the same verdict every time,
 * and retrying it spends a second page charge to be told the same thing. Only
 * transport failures, rate limits and server faults are transient here.
 */
export function isTransientVisionError(error: unknown): boolean {
  if (error instanceof VisionUnavailable) {
    const status = error.status;
    if (typeof status !== "number") return false;
    return status === 408 || status === 429 || status >= 500;
  }
  // A transport failure carries no status at all: `TypeError: fetch failed`
  // with the real reason on `cause.code`, plus AbortSignal's DOMException.
  const err = error as { name?: unknown; cause?: { code?: unknown } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return true;
  return typeof err?.cause?.code === "string";
}

/**
 * One page image, recognised.
 *
 * Returns the parsed `AnnotateImageResponse` -- the element, not the envelope
 * -- as `unknown`, because `src/lib/pipeline/vision-ocr.ts` validates the shape
 * rather than trusting a declaration. That split is what keeps the pipeline
 * free of provider knowledge and testable with no credential.
 */
export async function annotateImage(
  image: { bytes: Uint8Array; mediaType: string },
  options: { feature: string; languageHints: readonly string[] },
): Promise<unknown> {
  // A PRE-MINTED TOKEN, for environments that have no ADC to find.
  //
  // Production does not use this: on Cloud Run the runtime service account is
  // reachable through the metadata server and `GoogleAuth` finds it with no
  // configuration at all. It exists for a developer who has `gcloud auth
  // login` but not `gcloud auth application-default login` (they are separate
  // credentials, and only the second is ADC), and for a CI container with
  // neither.
  //
  // Deliberately a SHORT-LIVED ACCESS TOKEN and not a key file: it expires on
  // its own in an hour, so a copy that leaks is worth much less than a
  // downloaded service-account key, which is why `docs/runbook-deploy.md`
  // forbids those. Mint one with `gcloud auth print-access-token`.
  const override = process.env.VISION_ACCESS_TOKEN?.trim();
  const token = override || (await client().getAccessToken());
  if (!token) {
    throw new VisionUnavailable(
      "Application Default Credentials produced no access token for Cloud " +
        "Vision. On Cloud Run the runtime service account needs access to " +
        "vision.googleapis.com; locally run `gcloud auth application-default " +
        "login`. Unlike the Gemini path, an API key will not work here.",
    );
  }

  // Falls back to whatever project ADC itself resolved, so a developer who has
  // run `gcloud config set project` does not have to set a second variable.
  const project =
    quotaProject() ?? (override ? undefined : await client().getProjectId().catch(() => undefined));

  let response: Response;
  try {
    response = await fetch(`${VISION_ENDPOINT}/v1/images:annotate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(project ? { "x-goog-user-project": project } : {}),
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: Buffer.from(image.bytes).toString("base64") },
            features: [{ type: options.feature }],
            imageContext: { languageHints: [...options.languageHints] },
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Transport, not a verdict. Rethrown as-is so `isTransientVisionError`
    // can read `cause.code` off the original.
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new VisionUnavailable(
      `Cloud Vision HTTP ${response.status}: ${body.slice(0, 400)}`,
      response.status,
    );
  }

  const json = (await response.json()) as { responses?: unknown[] };
  const first = Array.isArray(json?.responses) ? json.responses[0] : undefined;
  if (first === undefined) {
    throw new VisionUnavailable(
      "Cloud Vision returned no response for the one image sent, which is a " +
        "shape this code does not know how to read rather than an empty page.",
    );
  }

  // A PER-IMAGE error travels INSIDE a 200, and reading past it would hand the
  // mapping an object with no `fullTextAnnotation` -- indistinguishable from a
  // genuinely blank page, which is the quiet failure this whole pipeline is
  // organised against. A blank page must reach the mapping as a blank page and
  // a refusal must reach the caller as an error.
  const err = (first as { error?: { message?: string; code?: number } }).error;
  if (err) {
    throw new VisionUnavailable(
      `Cloud Vision refused this image: ${err.message ?? JSON.stringify(err)}`,
      err.code,
    );
  }

  return first;
}
