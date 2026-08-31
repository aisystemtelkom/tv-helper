"use server";

/**
 * Allowlist mutations.
 *
 * Each action calls `requireAdmin()` itself. That is not belt-and-braces: a
 * Server Function is a POST to whatever route it happens to be used from, so a
 * proxy matcher never reliably covers it, and Next's own reference says to
 * verify inside the function. Deleting one of these calls silently opens the
 * allowlist to any signed-in operator.
 */

import { revalidatePath } from "next/cache";

import { isRole, type Role } from "@/lib/auth/allowlist";
import { allowlist } from "@/lib/auth/instance";
import { AuthorizationError, requireAdmin } from "@/lib/auth/require-user";

export type ActionState = { error: string | null; ok: string | null };

function describe(error: unknown): string {
  if (error instanceof AuthorizationError) return error.message;
  return error instanceof Error ? error.message : String(error);
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
    return { error: null, ok: `Added ${entry.email} as ${entry.role}.` };
  } catch (error) {
    return { error: describe(error), ok: null };
  }
}

export async function removeFromAllowlist(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin();
    const email = String(formData.get("email") ?? "");
    await allowlist().remove(email);
    revalidatePath("/admin");
    return {
      error: null,
      ok:
        `Removed ${email}. A live session keeps working for up to 60 seconds ` +
        "while the cached allowlist answer expires.",
    };
  } catch (error) {
    return { error: describe(error), ok: null };
  }
}
