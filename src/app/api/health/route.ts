/**
 * The liveness probe. Cloud Run, and anything else in front of this service,
 * needs one URL it can call to learn whether the container is up.
 *
 * THIS ROUTE IS DELIBERATELY THE ONLY UNAUTHENTICATED ONE, and it is trivial
 * on purpose. Three rules hold it to that, because every one of them has a
 * failure mode that turns a health check into an outage:
 *
 *   1. IT DOES NOT CALL THE GUARD. `requireApiUser()` would make an
 *      unauthenticated probe a 401, and a platform reading 401 as "unhealthy"
 *      restarts a container that was serving perfectly. Every other route
 *      gates itself (see src/lib/auth/require-user.ts); this one must not, so
 *      it is the single exception and says so where someone copying a route
 *      handler will read it.
 *   2. IT DOES NOT TOUCH FIRESTORE OR THE MODEL. A probe that depends on them
 *      turns a Firestore blip or a Gemini quota error into a rolling restart,
 *      which is strictly worse than the original fault: the app degrades
 *      gracefully for both -- the bootstrap owner still signs in when the
 *      allowlist is unreachable -- but not for being killed.
 *   3. IT ANSWERS FOR NOBODY BUT ITSELF. It reports that this process is
 *      running and can serve a request. It is not a dependency check and it
 *      must never grow into one.
 *
 * `src/proxy.ts` excludes `api/health` from its matcher for rule 1. That
 * exclusion is the other half of this file and the two must move together.
 *
 * The response carries no build id, no environment, no version and no
 * hostname: this URL is reachable without credentials, so it gets to say
 * exactly one thing.
 */

/**
 * Never prerendered. A statically generated probe would answer 200 from a
 * build-time snapshot even if the running process were wedged, which is the
 * exact wrong-and-quiet shape a health check exists to rule out.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      // A cached probe is not a probe. Cloud Run does not cache, but a proxy
      // or a browser between someone and this URL might.
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * A Cloud Run probe may be configured as HEAD, and a HEAD that 405s reads as
 * a failing probe. Next only derives HEAD from GET for statically rendered
 * routes, and this one is deliberately dynamic, so declare it.
 */
export const HEAD = GET;
