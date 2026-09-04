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
   * either and the app boots, renders, and then 404s everything under `public/`
   * in production while working perfectly under `next dev` -- the worst
   * failure shape, because it looks healthy until it does not.
   *
   * There used to be a `headers()` block here caching the vendored tesseract
   * wasm and traineddata for a week. Both the assets and the engine are gone:
   * scans are read by Cloud Vision now, so nothing large is served from
   * `public/` and there is nothing left to cache.
   */
  output: "standalone",

};

export default nextConfig;
