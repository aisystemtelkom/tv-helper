import { z } from "zod";
import { extractJson } from "./json.ts";

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

  // Nothing downstream confirms these spans -- this pipeline is headless --
  // so every page must land in exactly one span before spans are handed on.
  // A page belonging to no real document still has a home: the prompt
  // offers "Unknown". A gap or an overlap here is a classification bug, not
  // a legitimate shape, and must fail loudly with the pages at fault named.
  const coverage = new Array(pages.length).fill(0);
  for (const span of parsed.spans) {
    for (let p = span.fromPage; p <= span.toPage; p++) {
      coverage[p]++;
    }
  }

  const issues: string[] = [];
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i] === 0) {
      issues.push(`page ${i} not covered`);
    } else if (coverage[i] > 1) {
      issues.push(`page ${i} covered ${coverage[i]} times`);
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `spans must cover every page exactly once: ${issues.join(", ")}`,
    );
  }

  return parsed.spans;
}
