import { z } from "zod";

export type DocType = "KB" | "SP" | "BAPermintaan" | "Email" | "Unknown";
export type Span = { docType: DocType; fromPage: number; toPage: number };

/** Injected so this module never imports a provider SDK. */
export type Ask = (prompt: string) => Promise<string>;

const DOC_TYPES = ["KB", "SP", "BAPermintaan", "Email", "Unknown"] as const;

const Reply = z.object({
  spans: z.array(
    z.object({
      docType: z.enum(DOC_TYPES),
      fromPage: z.number().int().min(0),
      toPage: z.number().int().min(0),
    }),
  ),
});

/** How many characters of each page the model sees. Headings live at the top. */
const HEAD_CHARS = 400;

export function buildClassifyPrompt(
  pages: { index: number; head: string }[],
): string {
  const listing = pages
    .map((p) => `page ${p.index}: ${p.head.slice(0, HEAD_CHARS)}`)
    .join("\n");

  return [
    "You are segmenting a bundle of scanned Indonesian telecom order documents.",
    "Each page's opening text is given. Group consecutive pages into spans by",
    "document type. Every page must fall in exactly one span.",
    "",
    "Types:",
    "  KB           Perjanjian Kerjasama Berlangganan, the subscription contract",
    "  SP           Surat Penunjukan, the appointment letter",
    "  BAPermintaan Berita Acara Permintaan Order",
    "  Email        a printed email thread",
    "  Unknown      anything else",
    "",
    "A document may repeat; emit each occurrence as its own span.",
    'Reply with JSON only: {"spans":[{"docType":"KB","fromPage":0,"toPage":22}]}',
    "",
    listing,
  ].join("\n");
}

/** Models wrap JSON in prose or fences often enough that this is not optional. */
function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

export async function classifyPages(
  pages: { index: number; head: string }[],
  ask: Ask,
): Promise<Span[]> {
  const parsed = Reply.parse(extractJson(await ask(buildClassifyPrompt(pages))));
  const last = pages.length - 1;

  for (const span of parsed.spans) {
    if (span.fromPage > span.toPage) {
      throw new Error(`span reversed: ${span.fromPage} > ${span.toPage}`);
    }
    if (span.toPage > last) {
      throw new Error(`span toPage ${span.toPage} exceeds last page ${last}`);
    }
  }
  return parsed.spans;
}
