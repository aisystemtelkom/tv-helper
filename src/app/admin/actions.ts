"use server";

/**
 * Allowlist mutations.
 *
 * Each action calls `requireAdmin()` itself. That is not belt-and-braces: a
 * Server Function is a POST to whatever route it happens to be used from, so a
 * proxy matcher never reliably covers it, and Next's own reference says to
 * verify inside the function. Deleting one of these calls silently opens the
 * allowlist to any signed-in operator.
 *
 * WHAT THESE RETURN IS PART OF THE PRODUCT, NOT A DEBUG STRING.
 *
 * `removeFromAllowlist` used to return the sentence "A live session keeps
 * working for up to 60 seconds while the cached allowlist answer expires", and
 * `RemoveButton` read only `state.error` and dropped `state.ok` on the floor
 * while `revalidatePath` made the row vanish instantly. An admin removed a
 * departing employee, watched the row disappear, and concluded access was
 * gone. It was not, for up to a minute. That is this project's named failure
 * class, wrong-and-quiet, applied to access control instead of to crops.
 *
 * Two changes make that shape unavailable rather than merely discouraged:
 *
 *   1. The result is a DISCRIMINATED UNION, not two nullable strings. There is
 *      no value of `ActionState` a caller can render while ignoring the fact
 *      that a removal succeeded, because "succeeded" is a case, not a field
 *      that happens to be non-null.
 *   2. A success carries `graceMs`, the store's OWN ttl, rather than the
 *      editor hard-coding 60. The countdown the admin watches and the window
 *      the guard actually honours are then the same number by construction;
 *      changing `ALLOWLIST_TTL_MS` moves both.
 *
 * `message` is always a sentence in Bahasa Indonesia, for the admin. `detail`
 * is always the raw English text from the allowlist layer or from Auth.js, for
 * whoever is deploying, and the editor shows it only behind `Detail teknis`.
 * They never share a paragraph.
 */

import { revalidatePath } from "next/cache";

import {
  ALLOWLIST_TTL_MS,
  BOOTSTRAP_OWNER_EMAIL,
  isRole,
  normalizeEmail,
  type Role,
} from "@/lib/auth/allowlist";
import { allowlist } from "@/lib/auth/instance";
import { AuthorizationError, requireAdmin } from "@/lib/auth/require-user";

export type ActionState =
  /** Nothing has been submitted yet. The initial state, and only that. */
  | { status: "idle" }
  /**
   * The address is now in the store with this role. Deliberately not called
   * "added": `allowlist().add` writes the document whether or not it existed,
   * so submitting an address that is already listed changes its role rather
   * than failing. The editor says so above the form.
   */
  | { status: "saved"; email: string; role: Role }
  /**
   * The address is out of the store, and access survives for `graceMs` more
   * on any instance still holding a cached answer.
   */
  | { status: "removed"; email: string; graceMs: number }
  /** Nothing changed. `message` is for the admin, `detail` for the deployer. */
  | { status: "failed"; message: string; detail: string | null };

/**
 * Turn a thrown error into the two halves a screen needs.
 *
 * `AuthorizationError` already carries both, translated, from
 * `src/lib/auth/guard.ts`, so it is passed through rather than re-worded here:
 * one refusal, one wording, wherever it surfaces.
 *
 * The other two causes are things the ADMIN can fix, so they get a sentence
 * instead of a disclosure. They are recognised by the STABLE FRAGMENT of what
 * `src/lib/auth/allowlist.ts` throws, never by the whole string: if either
 * message is ever reworded this falls through to the generic sentence, which
 * is vague and true, rather than to a confident explanation that is wrong.
 */
function describe(error: unknown): { message: string; detail: string | null } {
  if (error instanceof AuthorizationError) {
    return { message: error.message, detail: error.detail ?? null };
  }

  const raw = error instanceof Error ? error.message : String(error);

  // The fragment, not the whole string. `allowlist.ts` throws
  // `"x" bukan alamat email.`; matching the middle of it survives the
  // quoted address changing and survives the sentence being re-punctuated,
  // and if the wording is ever rewritten this falls through to the generic
  // sentence, which is vague and true, rather than to a confident wrong one.
  if (raw.includes("bukan alamat email")) {
    return {
      message:
        "Itu bukan alamat email yang sah, jadi tidak ada yang disimpan. " +
        "Periksa ejaannya, lalu kirim lagi.",
      detail: raw,
    };
  }

  if (raw.includes(BOOTSTRAP_OWNER_EMAIL)) {
    return {
      message:
        "Alamat itu adalah pemilik bawaan. Aksesnya tertulis di dalam " +
        "aplikasi, bukan di daftar ini, jadi mengubahnya di sini tidak " +
        "mengubah apa pun.",
      detail: raw,
    };
  }

  return {
    message:
      "Daftar izin akses tidak dapat ditulis, jadi tidak ada yang berubah. " +
      "Coba lagi beberapa saat lagi.",
    detail: raw,
  };
}

export async function addToAllowlist(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const email = String(formData.get("email") ?? "");
    const role: Role = isRole(formData.get("role"))
      ? (formData.get("role") as Role)
      : "member";
    const entry = await allowlist().add({ email, role, addedBy: admin.email });
    revalidatePath("/admin");
    // `entry.email` rather than the submitted string: the store lowercases and
    // trims, and the admin should read back the address that is actually on
    // the list, not the one they typed.
    return { status: "saved", email: entry.email, role: entry.role };
  } catch (error) {
    return { status: "failed", ...describe(error) };
  }
}

/**
 * Takes the address itself rather than `FormData`.
 *
 * Removal is no longer a bare form post. It is armed, confirmed, and then
 * watched for a minute while the row sits struck through with a draining
 * counter, so the editor calls this directly and keeps the answer. The old
 * shape degraded, without JavaScript, to a click that made a row disappear and
 * said nothing at all -- which is precisely the belief this whole change
 * exists to stop an admin forming. Not offering that is better than offering
 * it silently.
 */
export async function removeFromAllowlist(
  email: string,
): Promise<ActionState> {
  try {
    await requireAdmin();
    await allowlist().remove(email);
    revalidatePath("/admin");
    return {
      status: "removed",
      email: normalizeEmail(email),
      graceMs: ALLOWLIST_TTL_MS,
    };
  } catch (error) {
    return { status: "failed", ...describe(error) };
  }
}
