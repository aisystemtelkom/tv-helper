import { createWorker } from "tesseract.js";
import type { RenderedPage } from "./render.ts";
import { groupWordsIntoLines, type Line, type Word } from "./geometry.ts";
import { encodePng } from "../export/png.ts";

/**
 * Paths are explicit because tesseract.js defaults to a CDN for its wasm core
 * and language data. That would put an unapproved third party in the
 * browser's request path, the same reason pdf.js keeps its bundled worker.
 * `scripts/vendor-ocr.mjs` copies these into public/tesseract at prebuild.
 */
export type OcrAssets = {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
};

const BROWSER_ASSETS: Required<OcrAssets> = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/",
  langPath: "/tesseract/",
};

export async function ocrToWords(
  page: RenderedPage,
  lang = "ind",
  assets: OcrAssets = {},
): Promise<Word[]> {
  const worker = await createWorker(lang, 1, {
    // Without this, a recognition failure is rethrown on a MessagePort tick
    // with no handler, which kills the whole process instead of rejecting.
    // The `finally` below would never run and the stack would not name this
    // function, so debugging starts from nothing.
    errorHandler: () => {},
    // gzip:true because @tesseract.js-data ships .traineddata.gz and the
    // vendoring step keeps it compressed. This must agree with what
    // scripts/vendor-ocr.mjs writes, or the fetch 404s.
    gzip: true,
    ...(typeof window === "undefined" ? {} : BROWSER_ASSETS),
    ...assets,
  });
  try {
    // tesseract.js has no raw-pixel path. It writes the bytes to a virtual
    // file and calls SetImageFile, which needs a decodable header, so raw
    // RGBA silently becomes a zero-length buffer and errors.
    const image = Buffer.from(await encodePng(page.data, page.width, page.height));
    const { data } = await worker.recognize(image, {}, { blocks: true });

    const words: Word[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const w of line.words ?? []) {
            if (!w.text.trim()) continue;
            words.push({
              text: w.text,
              box: {
                x: w.bbox.x0,
                y: w.bbox.y0,
                w: w.bbox.x1 - w.bbox.x0,
                h: w.bbox.y1 - w.bbox.y0,
              },
            });
          }
        }
      }
    }
    return words;
  } finally {
    await worker.terminate();
  }
}

export async function ocrToLines(
  page: RenderedPage,
  lang = "ind",
  assets: OcrAssets = {},
): Promise<Line[]> {
  return groupWordsIntoLines(await ocrToWords(page, lang, assets));
}
