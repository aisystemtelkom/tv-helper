/**
 * Google's own "G", for the key that hands the operator to Google.
 *
 * NOT A MEMBER OF `icons.tsx`, AND IT CANNOT BE ONE. That set's rule is that
 * colour arrives from the container and every path is `currentColor`. This is
 * somebody else's trademark in its own four colours, which Google's sign-in
 * branding asks to be shown unaltered on a white ground. It is a QUOTATION, in
 * the sense the uppercase rule uses the word, so its hues are not statuses and
 * say nothing about amber or red: they appear on the sign-in key and nowhere
 * else.
 *
 * INLINE, SO THERE IS STILL NOTHING TO FETCH. The sign-in page exists to keep
 * `authjs.dev` out of the request path, and a mark served from any host would
 * put one straight back. Paths in the markup cost no request, so
 * `performance.getEntriesByType("resource")` still shows only this origin.
 *
 * The white disc is what lets the G sit on a petrol key: the four colours on
 * petrol clash, and Google's own dark button solves it the same way.
 */
export function GoogleMark() {
  return (
    <span
      aria-hidden
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full"
      style={{ background: "#fff" }}
    >
      <svg width={16} height={16} viewBox="0 0 48 48">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    </span>
  );
}
