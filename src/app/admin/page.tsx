/**
 * The allowlist admin page. Admins and the owner only.
 *
 * It renders its own denial rather than throwing, so a member who follows a
 * link here gets a sentence instead of a stack trace. The mutations in
 * `actions.ts` re-check independently: rendering a page is not what authorizes
 * a write.
 *
 * FOUR THINGS CAN GO WRONG ON THE WAY TO THE REGISTER, and they are not the
 * same kind of thing, so they must not look the same. They used to: four
 * different conditions all rendered as the same amber or red bordered
 * paragraph, whether the cause was "you are not an admin" (expected, benign,
 * the visitor's own answer) or "the allowlist could not be read" (Firestore is
 * down, nobody can sign in, this is an incident). So a routine refusal is a
 * quiet sentence and an outage is an `Interruption`, the band that pushes the
 * page down and carries role="alert".
 *
 * THE RED AUTH_DISABLED BANNER THAT USED TO SIT AT THE BOTTOM OF THIS FILE
 * COULD NEVER RENDER, and deleting it is a fix rather than a tidy-up. When
 * `AUTH_DISABLED` is on, `createGuard` returns `via: "auth-disabled"` with
 * `isAdmin: false`, so the not-an-admin branch always returned first and the
 * banner below it was unreachable. The warning now lives in that branch, where
 * the state actually arrives, and it is the loudest thing this page can say:
 * an open deployment is the one condition under which strangers can open
 * client scans.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { Interruption, TechnicalDetail } from "@/components/operator/chrome";
import type { Role } from "@/lib/auth/allowlist";
import { allowlist } from "@/lib/auth/instance";
import { authorize, type AuthorizedUser } from "@/lib/auth/require-user";

import { AllowlistEditor } from "./allowlist-editor";

// The page depends on the session cookie, so it can never be prerendered.
// Stated rather than inferred: a future refactor that stops reading cookies at
// render time must not be allowed to turn this into a cached page.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Daftar Izin Akses - tv-validator",
};

/**
 * The roles in the words an admin uses.
 *
 * Kept in step with the same map in `allowlist-editor.tsx` BY HAND. That file
 * is a client component and this one is a server component, so importing the
 * map across the boundary would either hand this file a client reference it
 * cannot read or drag the Firestore client into the browser bundle. Three
 * short strings are the cheaper price.
 */
const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Administrator",
  member: "Operator",
};

/** How the guard admitted this person, said in words rather than as an enum. */
const VIA_LABEL: Record<AuthorizedUser["via"], string> = {
  allowlist: "lewat daftar izin akses",
  bootstrap: "sebagai pemilik bawaan",
  "auth-disabled": "tanpa autentikasi",
};

/**
 * The application strip and one measure for the page under it.
 *
 * IT IS THE TOOL, SO IT IS GLASS. `.lt-rail` is the material every piece of
 * app chrome takes: it stays still while the register scrolls under it, which
 * is the one question the design system asks before handing out a material.
 * The old note here called it "flat, hairline, no shadow", which described the
 * system before MEJA KACA; a rail is translucent, backdrop-blurred, lit along
 * its top edge and dropped beneath. What has not changed is the rule that
 * matters: it never holds a fact you read for meaning. It exists here mostly
 * to carry the way home. Nothing in the app linked to `/admin` and this page
 * linked back with one underlined word, so an admin arrived by typing a URL
 * and left the same way.
 *
 * This wants to be the product's one shared strip rather than a local copy;
 * see the report that landed this screen.
 */
function Shell({
  account,
  children,
}: {
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="lt-rail border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/" className="lt-wordmark">
            tv-validator
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {account}
            <Link href="/" className="lt-btn">
              Kembali ke aplikasi
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
        {children}
      </main>
    </>
  );
}

/**
 * A refusal: the sentence, the way out, and nothing else.
 *
 * The old shell kept the heading "Allowlist" and the subtitle about 60 seconds
 * above every denial, describing a table the visitor was never going to see.
 *
 * IT IS A BLOCK NOW, WHICH MEANS A SLAB THAT OPENS WITH A KOP. Every other
 * screen in the product states what a block owes in the bar across its top,
 * and this one used to state it nowhere: four different outcomes rendered as a
 * loose heading over a loose paragraph on the bare bench. The kop is the one
 * place the difference the file's header comment insists on is actually drawn.
 *
 *   AN OUTAGE OWES A FAULT AND A ROUTINE REFUSAL DOES NOT, and that asymmetry
 *   is the whole point of the `incident` flag. `--gap` covers both a fault and
 *   a refusal by the system's own definition, so painting the leading rule red
 *   on every denial would be defensible and would also be exactly the mistake
 *   this file was written to undo: "you are not an admin" is the visitor's own
 *   answer, expected and benign, and it must not look like Firestore being
 *   down. So the incident takes `data-owes="fault"` and the `Interruption`
 *   band with role="alert"; the refusal takes a plain kop and a quiet
 *   sentence. The word at the kop's right names which of the two it is
 *   without relying on the colour at all, so the distinction survives
 *   greyscale.
 */
function Refusal({
  title,
  children,
  detail,
  incident = false,
  signIn = false,
}: {
  title: string;
  children: ReactNode;
  /** Deployer-facing text: variable names, paths, a raw exception. */
  detail?: string;
  /** An outage rather than an answer, so it gets the band and role="alert". */
  incident?: boolean;
  /** The way out is the sign-in form rather than the app. */
  signIn?: boolean;
}) {
  return (
    <Shell>
      <section className="lt-slab" aria-labelledby={REFUSAL_HEADING}>
        <div className="lt-kop" data-owes={incident ? "fault" : undefined}>
          {/* A span rather than a heading: the h1 below is the top of this
              document, and a 13px kop cannot be the rank above it. */}
          <span>Daftar Izin Akses</span>
          <span className="lt-kop-right">
            {incident ? "gangguan" : "ditolak"}
          </span>
        </div>

        <div className="lt-slab-body flex flex-col gap-5">
          <h1 className="lt-title" id={REFUSAL_HEADING}>
            {title}
          </h1>
          {incident ? (
            <Interruption detail={detail}>{children}</Interruption>
          ) : (
            <>
              <p className="lt-lede">{children}</p>
              {detail ? <TechnicalDetail>{detail}</TechnicalDetail> : null}
            </>
          )}
          {/* One way out, and it goes where the sentence just told the visitor
              to go: a refusal that says "masuk dulu" and then offers only a
              link back to the page that refused them is a loop.

              A KEY RATHER THAN AN UNDERLINED WORD. It is the only thing this
              screen asks the visitor to do, and the system has one shape for
              that. The neutral key in the strip above is chrome; this is the
              action, so it is the one that carries the tone. `self-start`
              rather than a paragraph wrapper, which is what a key sitting in a
              flex column takes everywhere else in the product: a control is
              not a sentence and does not want a line box. */}
          <Link
            href={signIn ? "/signin" : "/"}
            className="lt-btn self-start"
            data-tone="primary"
          >
            {signIn ? "Masuk dengan Google" : "Kembali ke aplikasi"}
          </Link>
        </div>
      </section>
    </Shell>
  );
}

/**
 * The refusal's own heading id.
 *
 * A literal rather than `useId`: this is a server component, and at most one
 * `Refusal` is ever rendered in a response, so there is nothing to collide
 * with.
 */
const REFUSAL_HEADING = "penolakan-judul";

export default async function AdminPage() {
  const result = await authorize();

  // Not signed in, not on the list, no email, or the store did not answer.
  // The sentences are written once, in Bahasa Indonesia, in
  // `src/lib/auth/guard.ts`, and its `detail` half is the deployer's; keeping
  // them apart is that module's rule and this page honours it rather than
  // concatenating the two.
  if (!result.ok) {
    return (
      <Refusal
        title={
          result.reason === "lookup-failed"
            ? "Daftar izin akses tidak dapat dibaca"
            : "Halaman ini tidak bisa dibuka"
        }
        detail={
          result.detail
            ? `${result.reason}\n\n${result.detail}`
            : `${result.reason}`
        }
        incident={result.reason === "lookup-failed"}
        signIn={
          result.reason === "unauthenticated" || result.reason === "no-email"
        }
      >
        {result.message}
      </Refusal>
    );
  }

  // AUTH_DISABLED. The guard admits everyone as an anonymous member, so this
  // arrives here rather than in an admin branch, and it is not a permission
  // message: while it is on, anyone who knows the address can open this
  // deployment and the client scans an operator loads into it.
  if (result.user.via === "auth-disabled") {
    return (
      <Refusal
        title="Aplikasi ini sedang berjalan tanpa autentikasi"
        detail={
          "AUTH_DISABLED=true dan AUTH_GOOGLE_ID belum diisi, jadi " +
          "`createGuard` meloloskan setiap permintaan sebagai member " +
          "anonim dan `requireAdmin` selalu menolak. Ini mode bootstrap " +
          "sekali pakai untuk mendapatkan URL Cloud Run yang dibutuhkan " +
          "OAuth client. Selesaikan pemasangan OAuth di " +
          "docs/runbook-deploy.md, lepas AUTH_DISABLED, lalu deploy ulang."
        }
        incident
      >
        Tidak ada yang perlu masuk untuk membuka aplikasi ini, jadi tidak ada
        administrator dan daftar izin akses tidak bisa diubah. Selama begini,
        siapa pun yang tahu alamatnya bisa membuka aplikasi ini beserta dokumen
        yang dibuka di dalamnya. Beri tahu yang memasang aplikasi ini sekarang.
      </Refusal>
    );
  }

  if (!result.user.isAdmin) {
    return (
      <Refusal title="Halaman ini hanya untuk administrator">
        Anda masuk sebagai {result.user.email} ({ROLE_LABEL[result.user.role]}),
        dan hanya Pemilik atau Administrator yang boleh mengubah daftar izin
        akses. Minta administrator kalau ada orang yang perlu ditambahkan.
      </Refusal>
    );
  }

  let entries;
  try {
    entries = await allowlist().list();
  } catch (error) {
    return (
      <Refusal
        title="Daftar izin akses tidak dapat dibaca"
        detail={
          (error instanceof Error ? error.message : String(error)) +
          "\n\nFirestore: pembacaan koleksi allowlist gagal. Periksa binding " +
          "Firestore dan akses service account ke koleksi itu. Lihat " +
          "docs/runbook-deploy.md."
        }
        incident
      >
        Isinya tidak bisa ditampilkan, jadi tidak ada yang bisa ditambah atau
        dihapus dari sini sampai penyimpanannya bisa dibaca lagi. Ini masalah
        server, bukan masalah izin Anda. Halaman ini masih terbuka untuk Anda
        karena{" "}
        {result.user.via === "bootstrap"
          ? "Anda pemilik bawaan, yang memang diloloskan lewat kode supaya daftar yang kosong atau tidak terbaca tidak pernah mengunci pemilik di luar"
          : "jawaban daftar izin untuk akun Anda masih tersimpan di ingatan sementara server"}
        .
      </Refusal>
    );
  }

  return (
    <Shell
      account={
        // `text-ink-2` and `text-ink` rather than two inline `style` objects.
        // The utilities are generated from the same tokens `globals.css`
        // declares, so an element that is later moved onto a sheet picks up
        // the paper rebind instead of carrying the bench's near-white ink with
        // it. An address is a figure, hence `.lt-figure` and the full ink.
        <p className="text-[0.8125rem] text-ink-2">
          Masuk sebagai{" "}
          <span className="lt-figure text-ink">{result.user.email}</span> (
          {ROLE_LABEL[result.user.role]}, {VIA_LABEL[result.user.via]})
        </p>
      }
    >
      {/* THE PAGE'S OWN HEADER, DELIBERATELY NOT A SLAB. Everything that is a
          block on this screen is a slab with a kop, and this is not a block:
          it names the page the two slabs below sit on. Wrapping it in one
          would put a bar across the top of a title that has nothing to owe,
          and would make the register and the form read as nested inside it.
          `loading.tsx` draws the same header at the same measure so the real
          page arrives into the shape already on screen. */}
      <div className="flex flex-col gap-1">
        <h1 className="lt-title">Daftar Izin Akses</h1>
        <p className="lt-lede">
          Siapa saja yang boleh masuk ke tv-validator. Setiap perubahan di
          halaman ini adalah perubahan hak akses, dan tercatat atas nama akun
          yang sedang masuk.
        </p>
      </div>

      <AllowlistEditor entries={entries} currentEmail={result.user.email} />
    </Shell>
  );
}
