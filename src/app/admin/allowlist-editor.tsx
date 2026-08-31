"use client";

import { useActionState } from "react";

import {
  BOOTSTRAP_OWNER_EMAIL,
  ROLES,
  type AllowlistEntry,
} from "@/lib/auth/allowlist";

import {
  addToAllowlist,
  removeFromAllowlist,
  type ActionState,
} from "./actions";

const EMPTY: ActionState = { error: null, ok: null };

function Notice({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {state.ok}
      </p>
    );
  }
  return null;
}

function RemoveButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState(removeFromAllowlist, EMPTY);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? "Removing..." : "Remove"}
      </button>
      {state.error ? (
        <span className="text-xs text-red-700">{state.error}</span>
      ) : null}
    </form>
  );
}

export function AllowlistEditor({ entries }: { entries: AllowlistEntry[] }) {
  const [state, action, pending] = useActionState(addToAllowlist, EMPTY);

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Gmail address</span>
            <input
              name="email"
              type="email"
              required
              placeholder="operator@gmail.com"
              className="w-72 rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Role</span>
            <select
              name="role"
              defaultValue="member"
              className="rounded border border-neutral-300 px-2 py-1"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {pending ? "Adding..." : "Add"}
          </button>
        </div>
        <Notice state={state} />
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Role</th>
            <th className="py-2 pr-4 font-medium">Added by</th>
            <th className="py-2 pr-4 font-medium">Added</th>
            <th className="py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const bootstrap = entry.email === BOOTSTRAP_OWNER_EMAIL;
            return (
              <tr key={entry.email} className="border-b border-neutral-200">
                <td className="py-2 pr-4">{entry.email}</td>
                <td className="py-2 pr-4">{entry.role}</td>
                <td className="py-2 pr-4 text-neutral-600">
                  {entry.addedBy ?? (bootstrap ? "hardcoded in the app" : "-")}
                </td>
                <td className="py-2 pr-4 text-neutral-600">
                  {entry.addedAt?.slice(0, 10) ?? "-"}
                </td>
                <td className="py-2 text-right">
                  {bootstrap ? (
                    <span
                      className="text-xs text-neutral-500"
                      title="Admitted by code so an empty or unreachable allowlist cannot lock the owner out."
                    >
                      bootstrap owner
                    </span>
                  ) : (
                    <RemoveButton email={entry.email} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
