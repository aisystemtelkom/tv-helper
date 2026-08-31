import { deflateSync } from "node:zlib";
import { chunk } from "../src/lib/export/png.ts";

/**
 * Encode a solid-colour RGB PNG with no dependencies.
 *
 * A flat colour is a deliberately unambiguous vision probe: if the model can
 * name it, the whole image path (encode -> projector -> tokens) is working.
 */
export function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

  const row = Buffer.concat([
    Buffer.from([0]), // filter type "none"
    Buffer.concat(Array.from({ length: width }, () => Buffer.from([r, g, b]))),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
