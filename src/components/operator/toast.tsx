"use client";

/**
 * TRANSIENT CONFIRMATIONS, off the page.
 *
 * WHAT A TOAST IS FOR HERE: a fact that was true a moment ago, that the
 * operator does not have to act on, and that stops being interesting almost at
 * once. "Dokumen dihapus." "Order tersimpan." Those were printed into the
 * layout, which meant the screen grew a line every time something went right
 * and the work moved down.
 *
 * WHAT MAY NEVER BECOME ONE, and this list is the reason this file has a long
 * comment rather than a short one. Every item is a thing an earlier version of
 * some product has put in a toast, and every one of them is the failure this
 * project is organised against:
 *
 *   - A CONSENT OR PRIVACY STATEMENT. "Berkas PDF tidak diunggah" is the
 *     sentence the client's whole constraint rests on. A claim about where
 *     documents go that disappears after four seconds has not been made.
 *   - THE REASON A CONTROL IS DISABLED. It has to be readable at the moment
 *     the hand is on the control, which is not four seconds after something
 *     else happened.
 *   - A FAULT, A REFUSAL, OR ANYTHING OWED. `Interruption` exists for those,
 *     it sits in the sticky header, and it does not leave until it is dealt
 *     with. A refused save means every decision after it is being discarded,
 *     and an operator who was looking away has to still find that out.
 *
 * The test is not "is it short", it is "may the operator miss this entirely
 * and be no worse off". If the answer is no, it is not a toast.
 *
 * NO DEPENDENCY, and no portal. The host renders inside the app's own tree at
 * a fixed position; a portal would buy escaping an ancestor's stacking
 * context, which nothing here has. `aria-live="polite"` on the region means a
 * screen reader is told without being interrupted, which is exactly the
 * register a toast is for.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Tutup } from "./icons";

type Toast = { id: number; text: string };

const ToastContext = createContext<((text: string) => void) | null>(null);

/**
 * Announce something transient.
 *
 * Returns a no-op outside the provider rather than throwing. A screen that
 * says "saved" is not a screen that should fail to render in a test harness
 * that did not wrap it, and the alternative is every caller writing a guard.
 */
export function useSay(): (text: string) => void {
  return useContext(ToastContext) ?? noop;
}

function noop() {}

const LIFETIME_MS = 5000;

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const say = useCallback((text: string) => {
    const id = (next.current += 1);
    // ONE AT A TIME. A stack of these covers the corner of a contact sheet,
    // and two facts that are each not worth a line of layout are not worth
    // two floating cards either. The newest wins, because it is the one that
    // describes what just happened.
    setToasts([{ id, text }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts([]), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const value = useMemo(() => say, [say]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // `polite`, never `assertive`: nothing that reaches this region is
        // worth cutting off what a screen reader is currently saying, and
        // anything that would be belongs in `Interruption` instead.
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 p-6"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="lt-toast pointer-events-auto">
            <span className="flex-1">{toast.text}</span>
            {/* DISMISSIBLE, even though it leaves on its own. A toast sits
                over the bottom of the page, and the bottom of the page on the
                review sheet is evidence. Five seconds is a long time to wait
                to see a crop you are being asked to judge. */}
            <button
              type="button"
              aria-label="Tutup pesan"
              className="lt-disclose-btn"
              onClick={() => setToasts([])}
            >
              <Tutup size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
