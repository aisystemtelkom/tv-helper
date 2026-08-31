import { z } from "zod";
import type { Box } from "./render.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import type { Ask } from "./classify.ts";

export type OcrPage = {
  index: number;
  width: number;
  height: number;
  lines: Line[];
};

export type Zone = {
  pageIndex: number;
  box: Box;
  lineRange: [number, number];
};

export type LocateResult = {
  zone: Zone;
  text: string;
  confidence: "high" | "low";
} | null;

/**
 * A crop flush against the glyphs looks clipped once it is a picture in a
 * Word table. Twelve pixels at 300 DPI is about 1mm of white space.
 */
export const CROP_PADDING_PX = 12;

const Reply = z.object({
  pageIndex: z.number().int().min(0).nullable(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  confidence: z.enum(["high", "low"]),
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

export function buildLocatePrompt(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
): string {
  const listing = pages
    .map(
      (p) =>
        `--- page ${p.index} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  return [
    `Find the section of this document that answers the field "${slotLabel}".`,
    `What that field means: ${hint}`,
    "",
    "The pages below are OCR text with every line numbered. Choose the",
    "smallest contiguous run of lines that a reader would accept as proof of",
    "this field. Include the label line when there is one. Do not include",
    "unrelated paragraphs above or below.",
    "",
    'Reply with JSON only: {"pageIndex":0,"from":7,"to":8,"confidence":"high"}',
    'If no page contains it, reply {"pageIndex":null,"from":null,"to":null,',
    '"confidence":"low"}.',
    "",
    listing,
  ].join("\n");
}

export async function locateSlot(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
  ask: Ask,
): Promise<LocateResult> {
  const reply = Reply.parse(
    extractJson(await ask(buildLocatePrompt(slotLabel, hint, pages))),
  );

  if (reply.pageIndex === null || reply.from === null || reply.to === null) {
    return null;
  }

  const page = pages.find((p) => p.index === reply.pageIndex);
  if (!page) {
    throw new Error(`model returned pageIndex ${reply.pageIndex}, not offered`);
  }

  const bounds: Box = { x: 0, y: 0, w: page.width, h: page.height };
  const box = boxForLineRange(
    page.lines,
    reply.from,
    reply.to,
    CROP_PADDING_PX,
    bounds,
  );

  return {
    zone: { pageIndex: page.index, box, lineRange: [reply.from, reply.to] },
    text: page.lines
      .filter((l) => l.i >= reply.from! && l.i <= reply.to!)
      .map((l) => l.text)
      .join("\n"),
    confidence: reply.confidence,
  };
}
