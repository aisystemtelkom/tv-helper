import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Cloud Run runs this as a container, so the build has to produce something
   * that starts without `node_modules`. `standalone` emits `.next/standalone`
   * with a minimal `server.js` and only the traced dependencies.
   *
   * THE STANDALONE OUTPUT DOES NOT INCLUDE `public/` OR `.next/static`. Next's
   * own output reference says so: "This minimal server does not copy the
   * `public` or `.next/static` folders by default as these should ideally be
   * handled by a CDN instead". The Dockerfile copies both explicitly. Forget
   * either and the app boots, renders, and then 404s the vendored tesseract
   * wasm and `ind.traineddata` in production while working perfectly under
   * `next dev` -- which is the worst possible failure shape, because OCR
   * quietly stops instead of the page breaking.
   */
  output: "standalone",

  async headers() {
    return [
      {
        /**
         * The vendored OCR assets are roughly 15-20MB and every operator's
         * browser would otherwise re-fetch them per session.
         *
         * Deliberately NOT `immutable`. These filenames carry no content hash
         * -- `pnpm vendor:ocr` copies them out of node_modules under their
         * upstream names -- so `immutable` would pin a browser to the wasm it
         * first saw and a tesseract upgrade would reach nobody, silently. A
         * week of no requests at all, then a conditional GET that costs a 304,
         * buys almost all of the saving and still lets an upgrade land.
         */
        source: "/tesseract/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
