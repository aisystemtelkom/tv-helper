/**
 * The two pieces of the sign-in page that read attacker-supplied query string
 * values. Kept out of `page.tsx` so `node --test` can drive them: this module
 * has no imports at all, so it loads with no Next runtime and no bundler.
 */

/**
 * `callbackUrl` arrives from the query string, so it is attacker-supplied: a
 * link to `/signin?callbackUrl=https://evil.example` would otherwise turn this
 * page into an open redirect that borrows the app's own hostname, which is
 * worth more to a phisher than a redirect from anywhere else.
 *
 * Only a same-origin absolute path is accepted. `//evil.example` is
 * protocol-relative, and `/\evil.example` is treated as protocol-relative by
 * some browsers, so both are refused alongside anything carrying a scheme.
 * Anything refused becomes `/`, which is the app itself: a failure here sends
 * the operator somewhere harmless rather than nowhere.
 */
export function safeCallbackUrl(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * ONE FAILURE, TWO AUDIENCES, TWO STRINGS.
 *
 * Auth.js redirects failures to `pages.error` as `?error=<code>`, and
 * `src/lib/auth/config.ts` points that at the sign-in page. The four codes
 * below used to produce one English sentence each, and two of those sentences
 * named environment variables and a repo path at an operator who cannot act on
 * any of them.
 *
 * They are split now. `message` is the sentence the operator reads, in Bahasa
 * Indonesia, and it always ends in something they can do. `detail` is the
 * deployer's half: codes, variable names, the runbook. The page puts it behind
 * the `Detail teknis` disclosure, off the sheet, so the two audiences never
 * share a paragraph. Both audiences are real; they are not the same person.
 *
 * The raw code still survives, in `detail`, for an unrecognised failure. It is
 * the only string that makes the failure searchable, and swallowing it into
 * "something went wrong" would throw away the one clue. Moving it out of the
 * headline also takes an attacker-supplied string out of the sentence an
 * operator is asked to believe: whoever writes the link no longer gets to
 * choose the loudest words on the page.
 */
type SignInFailure = {
  /** Operator-facing, Bahasa Indonesia, always ends in an action. */
  message: string;
  /** Deployer-facing. Null when there is genuinely nothing technical to add. */
  detail: string | null;
};

function signInFailure(raw: string | string[] | undefined): SignInFailure | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;

  switch (code) {
    // The one an ordinary operator will actually see: what the `signIn`
    // callback returns for an account that is not on the allowlist. It is a
    // normal decision, not a fault, so there is nothing technical to disclose.
    case "AccessDenied":
      return {
        message:
          "Akun Google itu belum terdaftar di daftar izin akses. Minta " +
          "administrator menambahkannya, lalu masuk lagi.",
        detail: null,
      };
    case "Configuration":
      return {
        message:
          "Aplikasi ini belum siap menerima proses masuk. Hubungi " +
          "administrator.",
        detail:
          "Auth.js: error=Configuration. AUTH_SECRET, AUTH_GOOGLE_ID dan " +
          "AUTH_GOOGLE_SECRET harus terisi ketiganya. Lihat " +
          "docs/runbook-deploy.md.",
      };
    case "Verification":
      return {
        message:
          "Tautan masuk itu sudah dipakai atau sudah kedaluwarsa. Coba masuk " +
          "lagi dari halaman ini.",
        detail: "Auth.js: error=Verification.",
      };
    default:
      return {
        message:
          "Proses masuk gagal. Coba lagi, dan jika tetap gagal hubungi " +
          "administrator.",
        detail: `Auth.js: error=${code}.`,
      };
  }
}

/** The sentence the operator reads. Null when the sign-in has not failed. */
export function signInErrorMessage(
  raw: string | string[] | undefined,
): string | null {
  return signInFailure(raw)?.message ?? null;
}

/**
 * The deployer's half of the same failure, for the `Detail teknis` disclosure.
 * Null when the failure has nothing technical worth showing, which is the
 * common case: an account that was never added to the allowlist is working
 * exactly as designed.
 */
export function signInErrorDetail(
  raw: string | string[] | undefined,
): string | null {
  return signInFailure(raw)?.detail ?? null;
}
