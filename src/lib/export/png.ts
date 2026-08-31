/**
 * Minimal PNG encoder with no image-processing dependency (no `sharp`, no
 * `pngjs`). tesseract.js has no raw-pixel entry point -- it writes bytes to a
 * virtual file and calls `SetImageFile`, which needs a decodable image
 * header, so OCR cannot run without this. `scripts/png.mjs` used to keep its
 * own copy of the CRC and chunk-writing logic for its solid-colour
 * smoke-test PNG; it now imports `chunk` from here instead.
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
 * `CompressionStream` (the browser path) has no synchronous API -- it is a
 * WHATWG transform stream, which can only be consumed by awaiting its
 * output. `zlib.deflateSync` (the Node path) is synchronous, but this helper
 * stays async throughout so `encodePng` does not need an environment-specific
 * return type.
 */
async function deflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof window === "undefined") {
    const { deflateSync } = await import("node:zlib");
    return new Uint8Array(deflateSync(raw));
  }
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(raw);
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Encodes raw RGBA pixels (as produced by `CanvasRenderingContext2D.
 * getImageData`) into a PNG byte stream. tesseract.js's `SetImageFile` needs
 * a decodable image header; raw pixels handed to it directly become a
 * zero-length buffer and it throws.
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
