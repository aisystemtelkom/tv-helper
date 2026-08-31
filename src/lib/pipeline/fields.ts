import { z } from "zod";
import type { Ask } from "./classify.ts";
import type { OcrPage } from "./locate.ts";

export type FieldValue = {
  fieldKey: string;
  value: string;
  source?: { pageIndex: number; lineRange: [number, number] };
};

/**
 * Filenames carry the two ids reliably enough to prefill, and not reliably
 * enough to trust. Returning "" rather than a guess is deliberate: the
 * operator confirms every header field, and a blank invites that while a
 * plausible wrong value does not.
 */
export function deriveIdsFromFilenames(names: string[]): {
  idEpic: string;
  quote: string;
} {
  const joined = names.join(" ");
  // No \b anchors: "_" is a word character, so \bLOP\d+\b never matches
  // inside LOP285120_EXISTING_... which is exactly the shape of these names.
  return {
    idEpic: joined.match(/LOP\d{4,}/)?.[0] ?? "",
    quote: joined.match(/\d-\d{9,}/)?.[0] ?? "",
  };
}

const Reply = z.object({
  values: z.array(
    z.object({
      fieldKey: z.string(),
      value: z.string(),
      pageIndex: z.number().int().min(0).nullable(),
      from: z.number().int().min(0).nullable(),
      to: z.number().int().min(0).nullable(),
    }),
  ),
});

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

export async function extractFields(
  keys: string[],
  pages: OcrPage[],
  ask: Ask,
): Promise<FieldValue[]> {
  const listing = pages
    .map(
      (p) =>
        `--- page ${p.index} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  const prompt = [
    "Extract these fields from the numbered OCR lines below.",
    `Fields: ${keys.join(", ")}`,
    "",
    "Report only fields the text actually contains. Omit anything you would",
    "have to infer. For each one, cite the page and line range it came from.",
    'Reply with JSON only: {"values":[{"fieldKey":"cc","value":"PT X",',
    '"pageIndex":0,"from":3,"to":3}]}',
    "",
    listing,
  ].join("\n");

  const parsed = Reply.parse(extractJson(await ask(prompt)));

  return parsed.values
    .filter((v) => keys.includes(v.fieldKey) && v.value.trim() !== "")
    .map((v) => ({
      fieldKey: v.fieldKey,
      value: v.value,
      source:
        v.pageIndex !== null && v.from !== null && v.to !== null
          ? {
              pageIndex: v.pageIndex,
              lineRange: [v.from, v.to] as [number, number],
            }
          : undefined,
    }));
}
