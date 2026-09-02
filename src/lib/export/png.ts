/**
 * Minimal PNG encoder with no image-processing dependency (no `sharp`, no
 * `pngjs`).
 *
 * It was written for tesseract.js, which has no raw-pixel entry point -- it
 * writes bytes to a virtual file and calls `SetImageFile`, which needs a
 * decodable image header. That caller is on its way out and this file is not:
 * it is needed MORE now, because a rendered page is encoded here before it is
 * uploaded for OCR (`pageToPng` in `src/lib/pipeline/gemini-ocr.ts`, Node
 * branch), and because `cropToPng` and `scripts/png.mjs` already depend on it.
 * `scripts/png.mjs` used to keep its own copy of the CRC and chunk-writing
 * logic for its solid-colour smoke-test PNG; it now imports `chunk` from here
 * instead.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * A PNG chunk: 4-byte length, 4-byte ASCII type, the payload, then a CRC over
 * type+payload. Exported so `scripts/png.mjs` (the solid-colour smoke-test
 * PNG) can build its own IHDR/IDAT/IEND chunks without a second CRC
 * implementation.
 */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(type.length);
  for (let i = 0; i < type.length; i++) typeBytes[i] = type.charCodeAt(i);
  const body = concat([typeBytes, data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}

/**
 * One code path, `CompressionStream`, in every runtime. It is a WHATWG
 * transform stream with no synchronous API, which is why this helper is async
 * and why `encodePng` and `cropToPng` above it are too.
 *
 * IT USED TO BRANCH on `typeof window === "undefined"`, meaning "I am in
 * Node", and then `await import("node:zlib")`. That test is wrong for the
 * same reason it was wrong in `src/lib/pipeline/ocr.ts` (see `detectRuntime`
 * there, which documents it at length): a browser Web Worker has no `window`
 * either, and a Web Worker is where this project now renders and OCRs pages.
 *
 * BE PRECISE ABOUT WHAT THAT COST, because it is less than it looks and the
 * next person deserves the measured version. Under Turbopack it cost nothing:
 * building the worker with the old code and reading the emitted chunk shows
 * the bundler folding `typeof window` for a browser target and deleting the
 * `node:zlib` branch outright, leaving exactly the code below. The old branch
 * was therefore CORRECT BY BUNDLER CONSTANT-FOLDING, not by construction --
 * true only as long as whatever builds this keeps folding it, and a runtime
 * `ReferenceError`-free path only by luck. Removing the branch makes it true
 * by construction instead, which is the whole point of the ocr.ts fix.
 *
 * `CompressionStream("deflate")` emits zlib-wrapped deflate (RFC 1950),
 * exactly what a PNG IDAT chunk holds, and it is a global in Node 18+ as well
 * as in every browser this app supports. Measured on the same input,
 * `zlib.deflateSync` and this produce byte streams of identical length, and
 * the Node suite (`pnpm test`, which encodes and OCRs real PNGs) is green on
 * it. The Node path lost nothing by going away, and there is no environment
 * check left here to get wrong again.
 */
async function deflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(raw);
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Encodes raw RGBA pixels (as produced by `CanvasRenderingContext2D.
 * getImageData`) into a PNG byte stream.
 *
 * Three callers, and the header it writes matters to all of them. The docx
 * exporter needs a real PNG because `ImageRun` refuses anything else.
 * tesseract.js's `SetImageFile` needs a decodable image header; raw pixels
 * handed to it directly become a zero-length buffer and it throws. And the
 * OCR upload path reads its own width and height back out of the IHDR this
 * writes (`pngDimensions`), so that the coordinate space the model's boxes are
 * scaled against comes from the image rather than from a caller's claim.
 */
export async function encodePng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type "none"
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1);
  }

  const idat = await deflate(raw);

  return concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
