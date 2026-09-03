"use client";

/**
 * The allowlist, as a REGISTER: a ruled sheet of paper with one line per
 * person, and a form underneath for writing a new line.
 *
 * Two decisions here are the whole point of the screen.
 *
 * A REMOVED LINE IS STRUCK, NOT ERASED. `removeFromAllowlist` returns the fact
 * that a live session keeps working for up to a minute while other instances'
 * cached answers expire; the old editor read only the error half of the
 * result, threw the success away, and let `revalidatePath` delete the row from
 * the screen at once. An admin removed a departing employee, saw the row
 * disappear, and believed access was gone. It was not. So the row now STAYS IN
 * PLACE, its address struck through with the correction pen (`.lt-coretan`,
 * which is how a clerk voids a line so nothing can be written into it
 * afterwards), carrying a counter that drains, and it leaves only when the
 * counter reaches zero. Struck and still live at the same time, which is the
 * truth. A warning sentence would have been the cheap fix, and a sentence is
 * read once; the shape of the row is there for the whole minute.
 *
 * THE ROW THEREFORE CANNOT LIVE IN `entries`. Server state is authoritative
 * about who is on the list and knows nothing about a minute that is still
 * running, so `held` is this component's own record of the rows it is holding
 * on screen: one hold while the write is in flight, so a revalidation cannot
 * make the row blink out from under the admin, and one for the grace window
 * after it lands. When the counter reaches zero the hold is dropped AND the
 * server is asked again, so the list stops being this component's opinion the
 * instant it stops needing to be.
 */

import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Btn, Notice, TechnicalDetail } from "@/components/operator/chrome";
import {
  ALLOWLIST_TTL_MS,
  BOOTSTRAP_OWNER_EMAIL,
  ROLES,
  type AllowlistEntry,
  type Role,
} from "@/lib/auth/allowlist";

import {
  addToAllowlist,
  removeFromAllowlist,
  type ActionState,
} from "./actions";

const IDLE: ActionState = { status: "idle" };

/** The grace window, in whole seconds, which is how the copy says it. */
const GRACE_SECONDS = Math.round(ALLOWLIST_TTL_MS / 1000);

/**
 * The three roles in the words an admin uses.
 *
 * `owner`, `admin` and `member` are what Firestore stores and what the guard
 * compares. They are not three things a person should be asked to choose
 * between: on their own they say nothing about what any of them may do, which
 * is why the sentence above the register says it once, in full.
 *
 * `member` is "Operator" rather than a literal "Anggota" because that is the
 * word this product already uses for the people who work its screens.
 *
 * Kept in step with the same map in `page.tsx` BY HAND, and deliberately: that
 * file is a server component and this one is a client component, so importing
 * across the boundary would either hand the server a client reference it
 * cannot read or drag the Firestore client into the browser bundle.
 */
const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Administrator",
  member: "Operator",
};

/**
 * THE PAPER GROUND MOVED INTO `globals.css`, AND THIS NOTE IS WHY IT EXISTED.
 *
 * Kept rather than deleted with the constant, because the reasoning is what a
 * later pass would otherwise re-derive from scratch after re-introducing the
 * bug. This file used to carry a `PAPER_GROUND` object of a dozen custom
 * properties and hand it to the same element that already had the `.lt-paper`
 * class. That was a copy of the stylesheet living in a component.
 *
 * The argument was, and still is: `globals.css` defines the ink, the rules and
 * the correction pen against the graphite table, which is the ground almost
 * everything in this product sits on. The register is the exception the design
 * names: it is a document, so it lies on `.lt-paper`, and on paper every one
 * of those values is wrong. Near-white ink on warm white is invisible, the
 * bench's `--gap` measures 2.07:1 against `--paper` and its `--mark` 1.51:1 --
 * under the floor for a rule and far under it for text. That last figure is
 * one reason nothing on this sheet is amber anyway: an allowlist row owes no
 * decision, so the hue that means "a decision is owed here" has no business on
 * it.
 *
 * `.lt-paper` now rebinds every one of them itself, with the ratios measured
 * in the comment beside the rule: `--ink`, `--ink-2`, `--ink-3`, `--line`,
 * `--line-control`, `--line-strong`, `--edge`, `--surface-sunk`, `--gap`,
 * `--mark`, the whole button family, and `--focus-ring`. The last of those is
 * the one this constant was really written for: the global
 * `:focus-visible { outline: 2px solid var(--focus-ring) }` would otherwise
 * draw a near-white outline on white paper and leave a keyboard user pressing
 * Enter on a remove button they cannot see themselves land on. It is spelled
 * out on `.lt-paper` as `var(--ink)`, which computes against the paper ink the
 * same rule has just set, at 15.65:1.
 *
 * `--surface` is the only member of the old list that is NOT rebound, and it
 * does not need to be: this constant set it because `.lt-btn[data-tone=
 * "primary"]` used to paint its label `var(--surface)`. That button is petrol
 * with `--petrol-ink` now, and `var(--surface)` survives in exactly three
 * places in the stylesheet -- the `html` background, the `@theme` map, and the
 * shadcn `--background` alias -- none of which anything on this sheet paints.
 * Checked rather than assumed: no `bg-background` or `bg-surface` utility
 * appears anywhere in `src/`.
 *
 * SO: no inline token block on this screen. If a colour looks wrong on the
 * register, fix it on `.lt-paper` where every sheet in the product gets it,
 * not here where only this one does.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/**
 * `2026-09-02T04:10:00.000Z` becomes `2 Sep 2026`.
 *
 * Read LEXICALLY out of the ISO string, never through `new Date()`. This table
 * is rendered on the server and then hydrated in the browser, and a Cloud Run
 * instance in UTC and an operator in WIB disagree about the day for anything
 * written after 17:00 UTC. A date that changes between the HTML and the
 * hydrated render is a hydration error; a date quietly one day out in an audit
 * column is worse.
 */
function formatDate(iso: string | null): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!parts) return null;
  const month = MONTHS[Number(parts[2]) - 1];
  if (!month) return null;
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}

/** A row this component is holding on screen rather than taking from `entries`. */
type Held = {
  entry: AllowlistEntry;
  /** `removing` while the write is in flight, `struck` while the window drains. */
  phase: "removing" | "struck";
  /** Epoch ms at which the grace window closes. Meaningless while `removing`. */
  until: number;
};

/** The last thing a removal did, said once, where it can be announced. */
type Removal =
  | { kind: "removed"; email: string; seconds: number }
  | { kind: "closed"; emails: string[] }
  | { kind: "failed"; email: string; message: string; detail: string | null };

export function AllowlistEditor({
  entries,
  currentEmail,
}: {
  entries: AllowlistEntry[];
  /** The signed-in admin, so their own line can say so before they remove it. */
  currentEmail: string;
}) {
  const router = useRouter();
  const fieldId = useId();

  // The add form keeps its fields under control. React resets an uncontrolled
  // form once its action settles, which on a REJECTED address deletes the very
  // string the admin has to correct.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const emailField = useRef<HTMLInputElement>(null);

  const [held, setHeld] = useState<Held[]>([]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [, startRemoval] = useTransition();

  const [query, setQuery] = useState("");

  // Clearing the field and putting the caret back happens INSIDE the action,
  // not in an effect watching its result: it is an answer to a submission, not
  // a synchronisation with anything outside React, and the effect version
  // needed a ref just to tell one run of the action from the next.
  //
  // The cost is that `action` is now a client function that calls the Server
  // Function rather than the Server Function itself, so this form no longer
  // degrades to a plain POST without JavaScript. Everything else on this
  // screen already needs it (a struck row counting down cannot be rendered by
  // a server), and the sign-in form, which is the one surface that must keep
  // working without JavaScript, is untouched.
  const [addState, addAction, adding] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      // Same reason as the removal below: a request that never arrives rejects
      // rather than returning, and an admin should read a sentence about it
      // instead of meeting the error boundary.
      const state = await addToAllowlist(previous, formData).catch(
        (error: unknown): ActionState => ({
          status: "failed",
          message:
            "Permintaan tidak sampai ke server, jadi tidak ada yang " +
            "ditambahkan. Periksa koneksi Anda, lalu coba lagi.",
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      if (state.status === "saved") {
        setEmail("");
        // A second colleague is usually added right after the first, so the
        // caret goes back to where the next address is typed instead of to the
        // top of the document.
        emailField.current?.focus();
        // Re-adding an address inside its own strike window means access is
        // back. Leaving the coretan on that row would then be a lie.
        setHeld((prev) => prev.filter((h) => h.entry.email !== state.email));
      }
      return state;
    },
    IDLE,
  );

  // One ticker, running only while something is actually counting down. It
  // both moves the counters and retires a hold the moment its window closes,
  // and asking the server again at that point is what stops a held copy of a
  // row outliving the reason it was held. `nowMs` is seeded where a struck row
  // is created, so the effect body itself sets no state.
  useEffect(() => {
    if (!held.some((h) => h.phase === "struck")) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNowMs(at);
      const closed = held.filter((h) => h.phase === "struck" && h.until <= at);
      if (closed.length === 0) return;
      const emails = closed.map((h) => h.entry.email);
      setHeld((prev) => prev.filter((h) => !emails.includes(h.entry.email)));
      setRemoval({ kind: "closed", emails });
      router.refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [held, router]);

  const submitRemoval = useCallback(
    (entry: AllowlistEntry) => {
      setArmed(null);
      setHeld((prev) => [
        ...prev.filter((h) => h.entry.email !== entry.email),
        { entry, phase: "removing", until: 0 },
      ]);
      startRemoval(async () => {
        // A Server Function that never reaches the server REJECTS rather than
        // returning a failure, and an unhandled rejection here would leave the
        // row reading "Menghapus…" for the rest of the session with nothing
        // said about why. That is the same silence this screen exists to end,
        // so the throw is turned into the same answer as any other refusal.
        const state = await removeFromAllowlist(entry.email).catch(
          (error: unknown): ActionState => ({
            status: "failed",
            message:
              "Permintaan tidak sampai ke server. Periksa koneksi Anda, lalu " +
              "coba lagi.",
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        if (state.status === "removed") {
          const until = Date.now() + state.graceMs;
          setNowMs(Date.now());
          setHeld((prev) =>
            prev.map((h) =>
              h.entry.email === entry.email
                ? { entry, phase: "struck", until }
                : h,
            ),
          );
          setRemoval({
            kind: "removed",
            email: state.email,
            seconds: Math.round(state.graceMs / 1000),
          });
          return;
        }
        // The write did not land, so this is an ordinary live line again.
        // Holding it here would draw a red rule through access nobody revoked.
        setHeld((prev) => prev.filter((h) => h.entry.email !== entry.email));
        if (state.status === "failed") {
          setRemoval({
            kind: "failed",
            email: entry.email,
            message: state.message,
            detail: state.detail,
          });
        }
      });
    },
    [startRemoval],
  );

  const rows = useMemo(() => {
    const byEmail = new Map<
      string,
      { entry: AllowlistEntry; held: Held | null }
    >();
    for (const entry of entries) byEmail.set(entry.email, { entry, held: null });
    for (const hold of held) {
      // The held snapshot wins: for a row the server has already dropped it is
      // the only copy left, and for one the server still lists it is the copy
      // that knows which phase the row is in.
      byEmail.set(hold.entry.email, { entry: hold.entry, held: hold });
    }
    return [...byEmail.values()].sort((a, b) =>
      a.entry.email.localeCompare(b.entry.email),
    );
  }, [entries, held]);

  const needle = query.trim().toLowerCase();
  // A held row is never filtered away. It is carrying a message with a clock
  // on it, and a filter typed while that clock runs must not be able to hide
  // the one line on the page saying access has not ended yet.
  const visible = needle
    ? rows.filter((row) => row.held || row.entry.email.includes(needle))
    : rows;

  const onlyBootstrap =
    rows.length === 1 && rows[0]?.entry.email === BOOTSTRAP_OWNER_EMAIL;

  // What the register owes, and it is the STRUCK phase only.
  //
  // NOT `held.length > 0`, which is what this said first and which spent the
  // correction pen a phase too early. A hold in `removing` is a write still in
  // flight: nothing has been refused, nothing has failed, and nothing has been
  // revoked yet either. The row itself already says so, deliberately, by
  // setting "Menghapus…" in `--ink-2` rather than in the hue -- so turning the
  // whole block red underneath it contradicted the one line that knew the
  // truth, and it did it on EVERY removal, including the ones that go on to
  // fail (the hold is dropped, the red vanishes, and the actual failure notice
  // arrives afterwards). Red that comes and goes before the fault does is red
  // an admin learns to read past, on the screen where it matters most.
  //
  // Struck is different and is the state worth a container-scale signal: the
  // write landed, the row is voided, and access HAS NOT ENDED YET. That is
  // this project's named failure class applied to access control, it is the
  // reason the struck row exists at all, and the row and its annotation
  // already carry `--gap` for it. A healthy register owes nothing and shows no
  // colour, which is what makes the rule mean something when it appears.
  const stillLive = held.some((hold) => hold.phase === "struck");

  return (
    <div className="flex flex-col gap-10">
      {/* The one place a removal reports itself, and the only live region on
          the page. The counters in the rows are deliberately not live: an
          announcement every second for sixty seconds would bury the sentence
          that matters. */}
      <div role="status" aria-live="polite">
        {removal ? <RemovalReport removal={removal} /> : null}
      </div>

      {/* THE REGISTER IS A BLOCK, SO IT IS A SLAB THAT OPENS WITH A KOP. It
          used to be a loose heading, a loose paragraph and a sheet, three
          things on the bare bench with nothing saying they were one object.

          THE KOP CARRIES WHAT THIS BLOCK OWES, and here that is not a decision
          but a fault: while a struck row is still counting down, the register
          is telling the admin that somebody's access HAS NOT ENDED YET. The
          condition is `stillLive`, and the note on it above says why it is not
          simply "any hold". */}
      <section aria-labelledby={`${fieldId}-register`} className="lt-slab">
        <div className="lt-kop" data-owes={stillLive ? "fault" : undefined}>
          <h2 id={`${fieldId}-register`}>Orang yang punya akses</h2>
          {/* The count of lines on the register, in the mono the rest of the
              product sets a figure in, at the kop's one right-hand slot. */}
          <span className="lt-kop-right lt-figure">{rows.length}</span>
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <p className="lt-note">
              Pemilik dan Administrator boleh menambah dan menghapus akses di
              halaman ini. Operator hanya membuka aplikasi dan mengerjakan
              order.
            </p>

            {rows.length > 8 ? (
              <div className="flex flex-col gap-1.5">
                <label className="lt-label" htmlFor={`${fieldId}-cari`}>
                  Cari alamat
                </label>
                {/* `w-64` rather than an inline width. The utilities layer
                    wins over `.lt-input`'s own `width: 100%`, so the field is
                    sized by the same scale as everything else on the screen
                    instead of by a literal only this file knows about. */}
                <input
                  id={`${fieldId}-cari`}
                  type="search"
                  className="lt-input w-64"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="sebagian alamat"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}
          </div>

          {/* THE SHEET, INSIDE THE BLOCK. The register is a document and takes
              the product's one lit material; the block around it is the
              furniture the document lies on. `.lt-paper-body` is the system's
              own sheet padding, not the 20/16 this had. No token block: see
              the note at the top of this file for where that went. */}
          <div className="lt-paper lt-paper-body">
            {/* The caption is the table's accessible name, so there is no
                `aria-labelledby` here to override it: a screen reader landing
                on the table hears what its four columns are before reading a
                single address. */}
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Daftar alamat email yang boleh masuk ke tv-validator, dengan
                perannya, catatan siapa yang menambahkannya, dan tombol untuk
                menghapus aksesnya.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD} pr-4`}>
                    Alamat email
                  </th>
                  <th scope="col" className={`${HEAD} pr-4 whitespace-nowrap`}>
                    Peran
                  </th>
                  <th scope="col" className={`${HEAD} pr-4 whitespace-nowrap`}>
                    Ditambahkan
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    Tindakan
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr className={RULE}>
                    <td colSpan={4} className="py-4 text-[0.875rem]">
                      {needle ? (
                        <>
                          Tidak ada alamat yang memuat{" "}
                          <span className="lt-figure">{query.trim()}</span>.
                        </>
                      ) : (
                        // `allowlist().list()` always appends the bootstrap
                        // owner, so this cannot happen today. It is written
                        // down rather than left to render as an empty sheet,
                        // because a register with no lines and no sentence
                        // reads as a list that failed to load.
                        "Belum ada satu pun alamat di daftar ini. Tambahkan orang lewat formulir di bawah."
                      )}
                    </td>
                  </tr>
                ) : null}

                {visible.map((row) => (
                  <Line
                    key={row.entry.email}
                    entry={row.entry}
                    held={row.held}
                    nowMs={nowMs}
                    isSelf={row.entry.email === currentEmail}
                    armed={armed === row.entry.email}
                    onArm={() => setArmed(row.entry.email)}
                    onCancel={() => setArmed(null)}
                    onConfirm={() => submitRemoval(row.entry)}
                    confirmId={`${fieldId}-hapus-${row.entry.email}`}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p className="lt-note">
            <span className="lt-figure">{rows.length}</span> orang terdaftar.
            Perubahan berlaku paling lambat{" "}
            <span className="lt-figure">{GRACE_SECONDS}</span> detik.
            {onlyBootstrap
              ? " Baru pemilik bawaan yang ada di sini. Tambahkan operator lewat formulir di bawah."
              : null}
          </p>
        </div>
      </section>

      {/* THE ONE PLACE A NEW LINE IS WRITTEN, so it keeps `.lt-panel` -- the
          lifted member of the slab family, which `globals.css` records this
          screen as using for a block standing on the bench. The register is
          the record and this is the act, so the act sits a step above it.

          The kop takes the block's name and reports a refused write. It never
          takes amber: adding somebody is an action the admin chose, not a
          decision the screen is owed. */}
      <section aria-labelledby={`${fieldId}-tambah`} className="lt-panel">
        <div
          className="lt-kop"
          data-owes={addState.status === "failed" ? "fault" : undefined}
        >
          <h2 id={`${fieldId}-tambah`}>Tambah orang</h2>
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          <p className="lt-note">
            Alamat yang sudah terdaftar tidak menambah baris baru: perannya yang
            diperbarui.
          </p>

          <form action={addAction} className="flex flex-wrap items-end gap-4">
            <div className="flex min-w-[18rem] grow flex-col gap-1.5">
              <label className="lt-label" htmlFor={`${fieldId}-email`}>
                Alamat Gmail
              </label>
              {/* Wide, because access is granted by exact string and this is
                  the one field where a typo quietly admits the wrong person.
                  It used to be 288px, which does not hold a real address. The
                  cap is a utility now rather than an inline style: the
                  utilities layer wins over `.lt-input`, so nothing is lost and
                  the value stops being a literal only this file knows. */}
              <input
                ref={emailField}
                id={`${fieldId}-email`}
                name="email"
                type="email"
                required
                className="lt-input max-w-[28rem]"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@gmail.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="lt-label" htmlFor={`${fieldId}-peran`}>
                Peran
              </label>
              {/* The roles are read as words, so the select is set in the app's
                  own voice rather than in the figure face `.lt-input` carries
                  for addresses. */}
              <select
                id={`${fieldId}-peran`}
                name="role"
                className="lt-input w-auto font-sans"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>

            <Btn type="submit" tone="primary" disabled={adding}>
              {adding ? "Menambahkan…" : "Tambah"}
            </Btn>
          </form>

          <div role="status" aria-live="polite">
            {addState.status === "saved" ? (
              <Notice>
                Akses <span className="lt-figure">{addState.email}</span>{" "}
                tercatat sebagai {ROLE_LABEL[addState.role]}. Kalau orang itu
                baru saja ditolak waktu mencoba masuk, tunggu paling lambat{" "}
                {GRACE_SECONDS} detik lalu coba lagi.
              </Notice>
            ) : null}
            {addState.status === "failed" ? (
              <Notice tone="stop">
                <span>{addState.message}</span>
                {addState.detail ? (
                  <TechnicalDetail>{addState.detail}</TechnicalDetail>
                ) : null}
              </Notice>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

// Padding-right is added per column rather than carried here and cancelled on
// the last one: two utilities for the same property win by their order in the
// generated stylesheet, not by their order in the class attribute.
//
// THE COLOUR IS IN THE CLASS NOW, not in a `style` object handed to four
// `<th>`s. `text-ink-2` resolves `--ink-2` at the element it lands on, so a
// column heading reads as the sheet's second ink here and would read as the
// bench's if this table were ever moved off paper. An inline
// `color: var(--ink-2)` does the same thing, one call site at a time, with
// nothing to stop the fifth call site spelling a literal instead.
const HEAD = "py-2 text-[0.8125rem] font-semibold text-ink-2";

// The register's own ruling. `.lt-paper-rule` is the stylesheet's line for a
// sheet, so this file no longer decides what a rule on paper looks like. It
// must NOT be `border-t` from Tailwind: that resolves `--border`, whose value
// was computed at `:root` from the BENCH's `--line` and inherits down
// unchanged, so it would draw the graphite rule on white paper. `--paper-edge`
// is what a sheet is ruled with.
const RULE = "lt-paper-rule";

function RemovalReport({ removal }: { removal: Removal }) {
  if (removal.kind === "failed") {
    return (
      <Notice tone="stop">
        <span>
          Akses <span className="lt-figure">{removal.email}</span> tidak jadi
          dihapus, jadi orang itu masih bisa masuk. {removal.message}
        </span>
        {removal.detail ? (
          <TechnicalDetail>{removal.detail}</TechnicalDetail>
        ) : null}
      </Notice>
    );
  }

  if (removal.kind === "removed") {
    return (
      <Notice>
        Akses <span className="lt-figure">{removal.email}</span> dihapus. Sesi
        yang sedang berjalan masih berlaku hingga {removal.seconds} detik, jadi
        barisnya tetap ada dan dicoret sampai hitungannya habis.
      </Notice>
    );
  }

  return (
    <Notice>
      Hitungan selesai.{" "}
      <span className="lt-figure">{removal.emails.join(", ")}</span> sekarang
      benar-benar tidak bisa masuk lagi.
    </Notice>
  );
}

function Line({
  entry,
  held,
  nowMs,
  isSelf,
  armed,
  onArm,
  onCancel,
  onConfirm,
  confirmId,
}: {
  entry: AllowlistEntry;
  held: Held | null;
  nowMs: number;
  isSelf: boolean;
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmId: string;
}) {
  const bootstrap = entry.email === BOOTSTRAP_OWNER_EMAIL;
  const struck = held?.phase === "struck";
  const removing = held?.phase === "removing";
  const left = held && struck
    ? Math.max(0, Math.ceil((held.until - nowMs) / 1000))
    : 0;
  const date = formatDate(entry.addedAt);

  return (
    <>
      <tr className={RULE}>
        <td className="py-2.5 pr-4 align-top">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* The strike lands on the ADDRESS, which is the entry's identity
                and the thing being voided, rather than on the row as four
                separate segments that only join up while every cell happens to
                be exactly one line tall. */}
            <span
              className={`lt-figure text-[0.8125rem] break-words ${struck ? "lt-coretan" : ""}`}
            >
              {entry.email}
            </span>
            {isSelf ? (
              <span className="text-[0.8125rem] text-ink-2">akun Anda</span>
            ) : null}
          </span>
        </td>

        <td
          className={`py-2.5 pr-4 align-top text-[0.8125rem] whitespace-nowrap ${struck ? "text-ink-2" : ""}`}
        >
          {ROLE_LABEL[entry.role]}
        </td>

        {/* Provenance recedes. It used to be two of five columns, each of them
            a hyphen for any entry imported before the fields existed, at the
            same weight as the address. It is one column now, and an empty one
            says what is missing rather than drawing a dash. */}
        <td className="py-2.5 pr-4 align-top text-[0.8125rem] text-ink-2">
          {bootstrap ? (
            "ditulis di dalam aplikasi"
          ) : date || entry.addedBy ? (
            <span className="flex flex-col">
              <span className="lt-figure whitespace-nowrap">
                {date ?? "(tanggal tidak tercatat)"}
              </span>
              {entry.addedBy ? (
                <span className="break-words">
                  oleh <span className="lt-figure">{entry.addedBy}</span>
                </span>
              ) : null}
            </span>
          ) : (
            "(tidak tercatat)"
          )}
        </td>

        <td className="py-2.5 text-right align-top">
          {bootstrap ? (
            <span className="text-[0.8125rem] text-ink-2">pemilik bawaan</span>
          ) : struck ? (
            // The correction pen as PLAIN COLOURED TEXT, which is one of the
            // shapes the two hues are allowed to take. Never a filled chip
            // here: a fill would have to carry dark ink, and a word this small
            // reversed out of red beside a struck address is the clashing
            // gesture the whole palette was rebuilt to remove.
            <span className="text-[0.8125rem] text-gap">dihapus</span>
          ) : removing ? (
            <span className="text-[0.8125rem] text-ink-2">Menghapus…</span>
          ) : (
            <Btn
              onClick={onArm}
              aria-expanded={armed}
              aria-controls={armed ? confirmId : undefined}
            >
              Hapus
            </Btn>
          )}
        </td>
      </tr>

      {bootstrap ? (
        <tr>
          <td colSpan={4} className="pb-2.5 text-[0.8125rem] text-ink-2">
            Tidak dapat dihapus, agar pemilik tidak pernah terkunci di luar.
          </td>
        </tr>
      ) : null}

      {/* The clerk's annotation under a voided line. It is not itself struck:
          it is the sentence explaining why the line above still counts. */}
      {struck ? (
        <tr>
          <td colSpan={4} className="pb-2.5 text-[0.8125rem] text-gap">
            akses masih aktif, sisa <span className="lt-figure">{left}</span>{" "}
            detik
          </td>
        </tr>
      ) : null}

      {armed ? (
        <tr id={confirmId} className={RULE}>
          <td colSpan={4} className="py-3">
            {/* THE ONE DESTRUCTIVE CONFIRMATION IN THE PRODUCT, AND IT HAS TO
                LOOK LIKE ONE. It used to be an unmarked paragraph sitting in a
                table cell, indistinguishable from the provenance line two rows
                up, carrying a control with `autoFocus`.

                `.lt-notice[data-tone="stop"]` is the system's shape for that:
                a 3px rule of the correction pen down the leading edge and full
                ink for the sentence. NOT `.lt-band`, which is the other
                candidate and is wrong here for a measurable reason -- it tints
                itself against `--surface-raised`, which is the BENCH's raised
                slate and is not rebound on paper, so it would paint a dark box
                in the middle of a white sheet.

                The keys are inside it, so the rule runs down the whole
                decision rather than down its explanation only. */}
            <div
              className="lt-notice"
              data-tone="stop"
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancel();
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex max-w-[46ch] flex-col gap-1">
                  <p className="text-[0.9375rem] font-semibold">
                    Hapus akses{" "}
                    <span className="lt-figure">{entry.email}</span>?
                  </p>
                  <p className="text-[0.8125rem]">
                    Sesi yang sedang berjalan masih berlaku hingga{" "}
                    {GRACE_SECONDS} detik setelah Anda menekan Hapus. Barisnya
                    tetap di sini, dicoret, sampai hitungannya habis.
                  </p>
                  {isSelf ? (
                    <p className="text-[0.8125rem] text-gap">
                      Ini akun Anda sendiri. Menghapusnya akan mengeluarkan Anda
                      dari halaman ini.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {/* Focus moves to the confirmation, so the keyboard path to
                      a removal is arm, read, confirm, and never one Enter on a
                      button a keyboard user cannot see themselves land on.

                      THE RING IT LANDS ON IS THE SHEET'S, and that is now the
                      stylesheet's job rather than this file's: `.lt-paper`
                      rebinds `--focus-ring` to the paper ink, so the global
                      `:focus-visible` outline reads 15.65:1 here instead of
                      the near-white 1.08:1 it drew before. The label is
                      `--gap-ink`, which INVERTS on a sheet because the neutral
                      key does: 4.91:1 at rest, 5.16:1 on hover. Both of those
                      were carried by the inline token block this file used to
                      hold, and both are measured in `globals.css` now. */}
                  <Btn tone="reject" autoFocus onClick={onConfirm}>
                    Hapus
                  </Btn>
                  <Btn onClick={onCancel}>Batal</Btn>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
