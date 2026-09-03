"use client";

/**
 * Screen 1: MUAT DOKUMEN ORDER. Take the PDFs, load their pages, then have
 * the AI read them.
 *
 * This is the empty state of the whole product, so it is an invitation to act
 * rather than a form. The drop target is the screen's subject and gets the
 * space to say so; everything else here is either the promise made at the
 * moment of hand-over, the count of what is safely stored, or a plain account
 * of what this order now holds.
 *
 * THE SCREEN IS TWO MOVES, AND THEY ARE DELIBERATELY NOT ONE. Move one hands
 * the documents over and loads their pages (`Memuat`). Move two, `Process`
 * below, is the AI reading those pages into usulan (`Baca dengan AI`) -- two
 * verbs, because they used to share one and the screen said "membaca" twice
 * for two different operations. Move two is an explicit click
 * because it costs minutes of model calls over every page of the bundle: an
 * operator who has just noticed a missing document must be able to add it
 * BEFORE paying for that pass, which is impossible if handing a file over
 * starts one. The trigger used to live on the review screen, where the
 * operator had to find it after arriving at a sheet that looked simply empty.
 *
 * MOVE TWO HAS NO BAR, AND THAT IS A RULE RATHER THAN AN OMISSION. The film
 * strip below is honest because the app genuinely learns about whole pages,
 * one at a time. The search is ONE request for the whole run (`requestProposals`
 * in `src/lib/ui/propose.ts`), so there is no per-bagian progress to read and
 * no way to invent one that is not fiction. What stands in its place is a
 * SPINNER and the elapsed time. The spinner is not decoration: an operator
 * told us they could not tell a running pass from a hung one because nothing
 * on the block moved, and a multi-minute wait with a still screen is a wait
 * people walk away from. The seconds are the only number here that is true.
 *
 * THE FILM STRIP IS COUNTABLE, NEVER SMOOTH, and that is load-bearing rather
 * than stylistic. Loading a bundle of around thirty scanned pages takes
 * minutes, and a percentage would be a claim this app cannot make: it only
 * ever learns about WHOLE PAGES. A spinner is not a substitute for it either,
 * because a spinner cannot say how much is done. Where a spinner DOES belong
 * is the two moments this app has nothing countable to show, and there are
 * exactly two: before the first page total is known, and during move two.
 *
 * THE TICKS LAG THE WORK ON PURPOSE. Four pages are read at once, but
 * `ingestDocument` releases them strictly in page order, because the order
 * pages arrive in is the order they are stored in and a zone's page number is
 * a position in that list. So the count is what is SAFELY STORED, not what has
 * finished, which is the number an operator who closes the tab needs.
 *
 * WHAT THE PROMISE ON THIS SCREEN IS ALLOWED TO SAY, AND IT IS NOW ONE CLAUSE.
 * The screen used to carry the full architecture: the PDF is not uploaded, the
 * pages are rendered in this browser, and only a rendered page image goes to
 * this application's own server to be read. Every word of that is true and
 * none of it is the operator's business. Their own objection, and it settles
 * the whole class: "User don't need to learn that we're compliant when they're
 * trying to use each functionality of the app. Just put disclaimers in privacy
 * policy, and let the user know that the pdf isn't uploaded yet and that's
 * it." So what stays at the hand-over is the half they asked for and can act
 * on -- "Berkas PDF tidak diunggah." -- and the mechanism behind it now lives
 * only in `src/app/privacy/page.tsx`, which is where a compliance claim is
 * findable when somebody actually wants it.
 *
 * THAT IS A DELETION OF EXPLANATION, NEVER OF A REFUSAL. Every fault and every
 * interruption on this screen still states itself in prose and does not go
 * away until it is dealt with, and the counted, conditional lines all stayed:
 * how many halaman are short, how many read as blank, which berkas is
 * duplicated. What went is the text that would read word for word the same on
 * every order.
 *
 * WHY A DISABLED CONTROL NO LONGER PRINTS ITS REASON BESIDE ITSELF. Same
 * operator, same complaint: the key is down, that already reads as
 * unavailable, and a paragraph restating it is furniture on every screen
 * forever. `Btn`'s `reason` carries it to a pointer, to a keyboard and to a
 * screen reader instead, and the paragraph beside the button is now only ever
 * something the operator does not already know.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import type {
  BrowserRun,
  RunSource,
  RunSummary,
  StoredPage,
} from "@/lib/ui/runtime";

import {
  Advisory,
  Btn,
  Hint,
  Interruption,
  Notice,
  shortenFileName,
} from "./chrome";
import { Denah } from "./denah";
import { Arsip, Berkas, Cari, Muat } from "./icons";

/**
 * What the shell knows about an ingest in flight.
 *
 * `name`, `done` and `total` are the original contract and are unchanged.
 * `fileIndex` and `fileCount` are OPTIONAL additions for a multi-file drop:
 * the shell ingests files one after another, so without them three dropped
 * PDFs produce one file name and a rail that silently restarts twice, which an
 * operator cannot tell from a stuck one. Optional, so a caller that does not
 * supply them still type-checks and still renders correctly.
 */
export type IngestProgress = {
  name: string;
  done: number;
  total: number;
  fileIndex?: number;
  fileCount?: number;
};

/** A file this app can actually read. */
function isPdf(file: File): boolean {
  // Both tests, not the extension alone. A scan handed over through a chat app
  // or a mail client commonly arrives with the right MIME type and no
  // extension at all, and refusing that would be refusing a real document.
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * The place you put paper.
 *
 * Exported because the dokumen tambahan loop hands documents over too, and
 * both hand-over points must make the same promise in the same words.
 *
 * A FILE THAT IS NOT A PDF IS REFUSED OUT LOUD. It used to be dropped in
 * silence: `files.length > 0` guarded the callback, so dropping a JPG of a
 * scan produced no reaction whatsoever. That is this project's own failure
 * class moved into the interaction layer, because the operator walks away
 * believing the document is in the run, and the bagian it was meant to fill
 * ships empty on the record.
 */
export function DocumentDrop({
  label,
  hint,
  explain,
  disabled,
  onFiles,
  size = "hero",
  tone = "primary",
}: {
  label: string;
  /**
   * The half of the invitation that a different situation would print
   * differently. Optional, and omitted here on purpose: on this screen every
   * word of it read the same on every order, so all of it is in `explain`.
   */
  hint?: string;
  /**
   * The half that never changes, behind the question mark on the heading. It
   * is NOT where the consent sentence goes; that is printed below, always.
   */
  explain?: ReactNode;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  /** `inline` is the same target at a smaller height, for a secondary screen. */
  size?: "hero" | "inline";
  /**
   * WHETHER THIS IS THE SCREEN'S ONE MOVE. `primary` by default, because on
   * the empty state and inside the dokumen tambahan dialog it is: there is
   * nothing else to press. On an order that already holds pages it is not,
   * and the caller says so: the move there is `Baca dengan AI` further down,
   * and two primary keys in one column make the operator work out which one
   * the screen is asking for, which is the same as having none.
   */
  tone?: "primary" | "default";
}) {
  const input = useRef<HTMLInputElement>(null);
  // A drag over a CHILD element fires dragleave on the parent, so a boolean
  // toggled by those two events flickers the whole time the pointer is inside.
  // Counting enter against leave is the only version that stays lit.
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputId = useId();
  const labelId = useId();

  const take = (list: FileList | null) => {
    const all = [...(list ?? [])];
    const pdfs = all.filter(isPdf);
    const others = all.filter((file) => !isPdf(file));

    if (all.length === 0) {
      setRefusal(
        "Tidak ada berkas yang terbaca dari yang Anda jatuhkan. Coba pilih berkasnya lewat tombol di bawah.",
      );
      return;
    }

    if (others.length > 0) {
      const names = others
        .map((file) => shortenFileName(file.name, 28))
        .join(", ");
      setRefusal(
        pdfs.length > 0
          ? `Hanya berkas PDF yang bisa dibaca di sini, jadi yang ini dilewati: ${names}.`
          : `Bukan berkas PDF, jadi tidak ada yang dimuat: ${names}. Simpan dokumennya sebagai PDF dulu, lalu coba lagi.`,
      );
    } else {
      setRefusal(null);
    }

    if (pdfs.length > 0) onFiles(pdfs);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-labelledby={labelId}
        onDragEnter={(event) => {
          event.preventDefault();
          if (disabled) return;
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => {
          // Always prevented, even while disabled: without it the browser
          // treats the drop as a navigation and opens the operator's PDF over
          // the top of a running ingest.
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setOver(false);
          if (disabled) {
            // The card used to light amber on drag over while disabled and
            // then discard the file without a word. Saying no is the point.
            setRefusal(
              "Dokumen sedang dimuat. Tunggu sampai pemuatan selesai, lalu tambahkan berkasnya.",
            );
            return;
          }
          take(event.dataTransfer.files);
        }}
        /* A TRAY CUT INTO THE BENCH, NOT A DASHED RECTANGLE INHERITED FROM A
           FORM. This is the first thing an operator touches, and what stood
           here was a 2px dashed rule on a 4px corner: the squarest object in
           the product, drawn in the one geometry the client rejected by name.
           `.lt-well` is the system's recess -- the same material the film
           strip's trough below and the OCR transcript sit in -- so the place
           you put paper now reads as a place that HAS a place for it, by fill
           and depth rather than by a borrowed border. Measured, the recess is
           1.45:1 against the slab it is cut into, where the system's own
           lifted/set-in rule calls 1.22:1 enough to make a block an object.
           The tray is a tray before its edge is drawn at all.

           THE BLOCK RADIUS, NOT THE WELL'S OWN. `.lt-well` is 14px because
           most wells are control-sized; this one is the subject of the screen,
           so it takes the 20px block step off the same four-step scale.

           `--line-control` AT REST, BECAUSE THIS WHOLE CARD IS A CONTROL: it
           takes a drop. That token is the 3:1 boundary WCAG 1.4.11 asks of a
           control at rest, and here it measures 3.92:1 against the slab
           outside the tray and 5.68:1 against the recess inside it, so the
           edge holds in both directions. It is deliberately NOT
           `--line-strong`, which is the boundary of something ACTIVE -- and
           under the pointer that is exactly what this becomes: `--ink` at
           11.96:1 against the slab and 8.43:1 against its own lit fill.

           py-6, not py-12. The hero target was 290px of mostly empty
           rectangle on the screen an operator opens the product to, and a drop
           target does not become easier to hit by being taller than the thing
           being dropped on it. Its size should say "this is the main action",
           not "this is the main content". */
        className={`lt-well flex flex-col items-center gap-4 rounded-xl px-6 text-center transition-colors duration-90 ease-[var(--ease)] ${
          // THE DRAG TARGET IS INK, NEVER AMBER. Amber means a decision is
          // owed on a piece of evidence; where the pointer happens to be is
          // not that, and the two sharing one colour is what taught an
          // operator to stop reading amber at all.
          //
          // The fill under the pointer is `--wash`, the film a hand leaves,
          // which is the system's one recipe for "this is being touched and it
          // is not a key" (`.lt-btn[data-flat]:hover` is the other place it is
          // painted). It is written as `bg-[var(--wash)]` because the token is
          // deliberately absent from the Tailwind colour map: it is a neutral
          // white film to lay OVER whatever ground it lands on, not a colour
          // to paint with, and `bg-ink/6` would be an oklab mix, which this
          // system rules out by name. Naming the variable keeps it declarative,
          // so a runtime branch does not need a style object of its own.
          over ? "border-ink bg-[var(--wash)]" : "border-line-control"
        } ${size === "hero" ? "py-6" : "py-4"}`}
      >
        {/* The set's own drop mark, at the one size the set reserves for an
            empty state. What stood here was the same drawing on a 40 viewBox
            with its own stroke widths: a foreign grid beside every other icon
            in the product. */}
        <Muat size={40} className="text-ink-3" />

        {/* The question mark sits BESIDE the heading, never inside the
            sentence under it, so the row it belongs to is unambiguous. */}
        <div className="flex items-center gap-1">
          {/* `.lt-title`, NOT A SIZE OF ITS OWN. This was `text-[1.0625rem]`,
              17px, which is on no rung of the type scale: the system paints
              13, 14, 15, 21, 22 and 34 and nothing between 15 and 21, so a
              heading at 17 was a private size that no other rule in the
              product agrees with. The role already exists -- `.lt-title` is
              the class for a screen or section title -- and this heading is
              the subject of the screen it opens: the invitation the whole
              empty state is built around. Taking the role rather than an
              arbitrary size is also what keeps the two hand-over points (this
              one and the dokumen tambahan dialog) reading as one object. */}
          <h3 id={labelId} className="lt-title">
            {label}
          </h3>
          {explain ? <Hint label={`Penjelasan: ${label}`}>{explain}</Hint> : null}
        </div>

        {hint ? (
          <p className="text-ink-2 max-w-[52ch] text-[0.9375rem]">{hint}</p>
        ) : null}

        <label htmlFor={inputId} className="sr-only">
          Pilih berkas PDF dari komputer Anda
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(event) => {
            take(event.target.files);
            // Cleared, so choosing the same file twice still fires `change`.
            event.target.value = "";
          }}
        />
        {/* THE KEY CARRIES ITS OWN REFUSAL. The drop half of this card
            already says no out loud when a file is dropped on it mid-ingest;
            the key beside it went down silently. `reason` is the same
            sentence, reached by pointer, keyboard and screen reader, so
            neither half of one target can refuse without saying why. */}
        <Btn
          tone={tone}
          disabled={disabled}
          reason={
            disabled
              ? "Dokumen sedang dimuat. Tunggu sampai pemuatan selesai, lalu tambahkan berkasnya."
              : undefined
          }
          onClick={() => input.current?.click()}
        >
          Pilih berkas PDF
        </Btn>

        {/* THE FACT, WITHOUT THE ARCHITECTURE. This used to run on: "Halaman
            dirender di peramban ini, dan hanya gambar halaman yang dikirim ke
            server aplikasi untuk dibaca teksnya." All true, and all of it is
            us explaining our own build to somebody trying to finish an order.
            What the operator asked to keep is the part that is about their
            document: the PDF has not gone anywhere. The rest is in the privacy
            policy, which is where a claim like it can be read in full.

            Safety copy, so it never uses `--ink-3`; it was once set in the
            least readable colour in the system at 12px. */}
        <p className="text-ink-2 max-w-[62ch] text-[0.8125rem]">
          Berkas PDF tidak diunggah.
        </p>
      </div>

      {/* The live region sits in the DOM before it has anything to say, so a
          refusal is announced when it appears rather than when the region is
          first inserted. */}
      <div role="status" aria-live="polite">
        {refusal ? <Notice tone="stop">{refusal}</Notice> : null}
      </div>
    </div>
  );
}

/**
 * ONE TICK PER PAGE, filled as that page is committed to storage.
 *
 * Before the first page lands the runtime has not said how many there are, so
 * the rail is EMPTY rather than full width at nothing. A trough with no ticks
 * is honest about a total nobody knows yet, where "halaman 0 dari 0" over a
 * bar was the first thing an operator saw after handing over a 29 page bundle.
 */
function FilmStrip({ done, total }: { done: number; total: number }) {
  if (total <= 0) return <div className="lt-well h-6 w-full" />;

  return (
    <div
      className="lt-well flex h-6 w-full overflow-hidden p-0"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} dari ${total} halaman tersimpan`}
      aria-label="Halaman yang sudah tersimpan"
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="lt-tick"
          data-done={i < done}
          style={{ width: `${100 / total}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The block the operator watches for minutes.
 *
 * IT SAYS MEMUAT, NOT MEMBACA, AND THE TWO WORDS NOW MEAN DIFFERENT MOVES.
 * Both halves of this screen used to be "membaca": the pages were read here
 * and then `Proses` searched them, and an operator reading the screen top to
 * bottom met the same verb twice for two different operations minutes apart.
 * Move one is MUAT, which is what the phase is already called, and move two is
 * the AI reading the document. One word each, and the flow names itself.
 */
function Reading({ progress }: { progress: IngestProgress }) {
  const named = progress.name.length > 0;
  const counting = progress.total <= 0;

  return (
    <section
      className="border-line flex flex-col gap-4 border-y py-5"
      aria-labelledby="ingest-reading"
    >
      <div>
        {/* The live region is the HEADING ITSELF, not a wrapper round it and
            the question mark. Announced once per FILE rather than once per
            page: a screen reader user waiting several minutes wants to know
            which document is being read, not to be interrupted twenty-nine
            times, and certainly not to have the hint's own name read out with
            every file. The page count lives on the progressbar, where it can
            be asked for. */}
        <div className="flex items-center gap-1">
          <h3
            id="ingest-reading"
            aria-live="polite"
            className="text-[0.9375rem] font-semibold"
          >
            {named ? (
              <>
                Memuat{" "}
                <span className="lt-figure" title={progress.name}>
                  {shortenFileName(progress.name)}
                </span>
              </>
            ) : (
              "Memuat dokumen"
            )}
          </h3>
          {/* WHAT IS LEFT IN HERE IS A CONSEQUENCE, NOT A MECHANISM. This hint
              used to explain the machine: rotated pages are straightened
              first, four pages are read at once, and the tick count therefore
              lags the work. Every clause was true and none of it changes
              anything the operator does, which is the test. What survives is
              the one thing that changes what they do if the loading stops:
              nothing already stored is lost, so the answer is to load the
              file again rather than to start the order over. */}
          <Hint label="Penjelasan pemuatan halaman">
            Kalau pemuatan berhenti di tengah jalan, halaman yang sudah masuk
            tidak hilang. Muat berkas yang sama lagi untuk melanjutkan.
          </Hint>
        </div>
        {progress.fileCount && progress.fileCount > 1 ? (
          <p aria-live="polite" className="text-ink-2 text-[0.8125rem]">
            Berkas ke-<span className="lt-figure">{progress.fileIndex ?? 1}</span>{" "}
            dari <span className="lt-figure">{progress.fileCount}</span> yang
            Anda berikan.
          </p>
        ) : null}
      </div>

      <FilmStrip done={progress.done} total={progress.total} />

      {/* THE SPINNER IS ONLY HERE, AND ONLY WHILE THE TROUGH IS EMPTY. Before
          the first page lands the runtime has not said how many there are, so
          the film strip above is a blank recess and this was the one moment in
          a multi-minute wait with nothing moving on the screen at all. Once
          ticks start arriving they are the motion, and a second indicator
          beside them would be two drawings of one fact. */}
      <p className="text-ink flex items-center gap-3 text-[0.9375rem]">
        {counting ? (
          <>
            <span className="lt-spinner" aria-hidden="true" />
            {/* NOT "Membuka berkas dan menghitung halamannya." Counting pages
                sounds like something that finishes instantly, and it takes a
                while, so the sentence made the app look slow at the exact
                moment it was working. What the operator needs is that their
                document is on its way in. */}
            <span>Dokumen sedang dimuat.</span>
          </>
        ) : (
          <span>
            <span className="lt-figure">{progress.done}</span> dari{" "}
            <span className="lt-figure">{progress.total}</span> halaman sudah
            tersimpan.
          </span>
        )}
      </p>

      {/* The one clause of the old three-sentence advisory that can still cost
          the operator minutes of work if it is missed: close the tab and the
          pages that have not landed yet are not loaded. The other two said how
          the storing works, which is the same on every run and now says
          nothing to anybody. */}
      <Advisory>
        <span>Biarkan tab ini terbuka sampai pemuatan selesai.</span>
      </Advisory>
    </section>
  );
}

type SourceTally = {
  source: RunSource;
  pages: StoredPage[];
  /** The document's own length, recorded from the first page message on. */
  expected: number;
};

function tally(run: BrowserRun): SourceTally[] {
  return run.sources.map((source) => ({
    source,
    pages: run.pages.filter((page) => page.sourceId === source.id),
    expected: source.pageCount,
  }));
}

/**
 * What this order now holds, and where it is short.
 *
 * THE RECONCILIATION IS THE POINT. An interrupted ingest records the
 * document's own length on the source and stores only the pages that actually
 * landed, so "29 halaman" and "19 halaman termuat" are both true, and they
 * used to sit two lines apart as equals. A run that is genuinely incomplete
 * looked complete, and every bagian living on the ten unread pages comes back
 * `tidak ditemukan` for a reason the operator reads as "the document does not
 * contain it".
 *
 * THE PAGE PLANS ARE HERE FOR THE REASON THEY ARE ON THE REVIEW SHEET. This is
 * the first moment the operator can catch a wrong file, a blank page or a scan
 * that would not read, and catching it here costs seconds where catching it
 * after the search costs a whole pass. They are free: `StoredPage` already
 * carries the line boxes, so this is inline SVG and no bitmap, no blob URL and
 * no model call.
 */
function RunContents({ run }: { run: BrowserRun }) {
  const tallies = tally(run);
  const expected = tallies.reduce((sum, one) => sum + one.expected, 0);
  const read = run.pages.length;
  const short = Math.max(0, expected - read);
  const unreadable = run.pages.filter((page) => page.lines.length === 0).length;
  const names = run.sources.map((source) => source.name);
  const duplicated = new Set(names).size !== names.length;

  return (
    <section
      className="border-line flex flex-col gap-4 border-t pt-5"
      aria-labelledby="ingest-contents"
    >
      <h3 id="ingest-contents" className="text-[0.9375rem] font-semibold">
        Isi order ini
      </h3>

      {run.sources.length === 0 ? (
        <p className="text-ink-2">
          Order ini belum berisi berkas apa pun. Taruh berkas PDF di kotak
          di atas untuk mulai.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {tallies.map(({ source, pages, expected: length }) => {
            const missing = Math.max(0, length - pages.length);
            return (
              <li key={source.id} className="flex flex-col gap-2">
                {/* THE FOLD IS THE INFORMATION. This row is a berkas the
                    operator supplied, and directly under it sit the
                    square-cornered plans of the halaman inside it. The two
                    kinds of object are mixed in one block, which is the only
                    place in this screen an icon discriminates anything: on the
                    runs list below, every row is a order and a glyph on
                    each would say nothing. */}
                <p
                  className="flex items-center gap-2 text-[0.9375rem]"
                  title={source.name}
                >
                  <Berkas className="text-ink-3" />
                  <span className="lt-figure">
                    {shortenFileName(source.name, 44)}
                  </span>
                </p>

                <p className="text-ink-2 text-[0.8125rem]">
                  {length === 0 && pages.length === 0 ? (
                    "Belum ada halaman yang terbaca dari berkas ini."
                  ) : missing > 0 ? (
                    <span className="text-gap">
                      <span className="lt-figure">{pages.length}</span> dari{" "}
                      <span className="lt-figure">{length}</span> halaman
                      terbaca, <span className="lt-figure">{missing}</span>{" "}
                      halaman belum masuk.
                    </span>
                  ) : (
                    <>
                      <span className="lt-figure">{pages.length}</span> halaman
                      terbaca.
                    </>
                  )}
                </p>

                {pages.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {pages.map((page) => (
                      <Denah
                        key={page.id}
                        page={page}
                        size="sm"
                        label={`Halaman ${page.index + 1} dari ${source.name}`}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* The total is only worth stating once there is something to total, and
          the "no berkas at all" sentence above already covers an empty run. */}
      {run.sources.length === 0 ? null : read > 0 ? (
        <p className="text-ink">
          <span className="lt-figure">{read}</span> halaman dari{" "}
          <span className="lt-figure">{run.sources.length}</span> berkas siap
          diperiksa.
        </p>
      ) : (
        <p className="text-ink">
          Belum ada satu halaman pun yang tersimpan di order ini. Muat ulang
          berkasnya untuk mencoba lagi.
        </p>
      )}

      {short > 0 ? (
        <Advisory>
          <span>
            <span className="lt-figure">{short}</span> halaman belum terbaca.
            Bagian yang ada di halaman itu akan tercatat tidak ditemukan. Muat
            ulang berkas yang kurang sebelum melanjutkan.
          </span>
        </Advisory>
      ) : null}

      {unreadable > 0 ? (
        <Advisory>
          <span>
            <span className="lt-figure">{unreadable}</span> halaman terbaca
            gambarnya, tetapi tidak ada satu pun teks di dalamnya yang terbaca.
            Halaman itu bergaris coret di denahnya. Periksa apakah halaman itu
            memang kosong.
          </span>
        </Advisory>
      ) : null}

      {duplicated ? (
        <Advisory>
          <span>
            Ada dua berkas dengan nama yang sama di order ini. Periksa
            apakah salah satunya termuat dua kali.
          </span>
        </Advisory>
      ) : null}
    </section>
  );
}

/** Seconds, ticking, in its own component so only this node re-renders. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");

  // The mono is the DOCUMENT's voice and carries the FIGURE alone. Setting
  // the whole sentence in it put "Sudah" and "berjalan" in the typeface this
  // product reserves for page numbers and identifiers, which is the habit of
  // using mono to make a small line look technical.
  return (
    <span className="text-ink">
      Sudah{" "}
      <span className="lt-figure">
        {minutes}:{rest}
      </span>{" "}
      berjalan.
    </span>
  );
}

/**
 * MOVE TWO: the AI reads the document, on the screen that produced the pages.
 *
 * IT IS NO LONGER CALLED "PROSES", AND THE OPERATOR IS THE ONE WHO KILLED THE
 * WORD: "it can mean a lot of thing". They are right. `Proses` names no
 * object, no agent and no result, so a key labelled with it is a key you press
 * to find out what it does, which on a control that costs minutes of model
 * calls is the wrong way round. The block now says the thing that is actually
 * happening in the operator's own terms: an AI reads this document and marks
 * where each bagian is. The stem still runs through every state word here, it
 * is just a stem that means something.
 *
 * THE OTHER HALF OF THE RENAME IS UPSTREAM. Move one used to be "membaca"
 * too, so the screen said read twice for two different operations; it is
 * `Memuat` now, which is what the phase itself is called. See `Reading`.
 *
 * WHAT THIS BLOCK IS ALLOWED TO PRINT. It is a multi-minute wait, and the
 * three sentences it used to spend on itself are gone: how many halaman of
 * text the request carries, that the text goes to this application's server,
 * and that it takes a few minutes. None of the three changes anything the
 * operator does. The one that does is that closing the tab throws the pass
 * away, so that stays, and it is the only thing left beside the button.
 *
 * THERE IS STILL NO BAR, and now there is a SPINNER instead of a still screen.
 * `requestProposals` is a single POST for the whole run, so a filling
 * rectangle would be a drawing of a number nobody has. But a still block for
 * several minutes is indistinguishable from a hung one, which is exactly what
 * an operator reported, so the wait moves: `.lt-spinner` beside the sentence,
 * and the elapsed seconds under it, which is the only true number here.
 */
function Process({
  wanted,
  searching,
  startedAt,
  note,
  busy,
  onProcess,
}: {
  wanted: number;
  searching: boolean;
  startedAt: number | null;
  note: string | null;
  busy: boolean;
  onProcess: () => void;
}) {
  const blocked = busy || wanted === 0;
  const why = "ingest-process-why";

  // WHY THE KEY WILL NOT ANSWER, ON THE KEY. The rule that a disabled control
  // never appears without its reason has not moved; where the reason is
  // printed has. These two used to be paragraphs in the layout, and the
  // operator's objection to that shape was that they "are redundant too. The
  // user know they can't proceed since the button is already disabled".
  // `Btn`'s `reason` reaches a pointer, a keyboard and a screen reader, so no
  // modality loses it, and the screen stops carrying a sentence about a
  // control nobody is touching.
  //
  // THE RUNNING STATE IS NOT ONE OF THEM, and leaving it out is the point of
  // the rule rather than an exception to it. The key is disabled while the
  // pass runs, but it says "Sedang membaca..." on its own face and the live
  // region directly above it says the same thing at length. A hover reason
  // there would be a third copy of a fact already stated twice.
  const reason = busy
    ? "Halaman masih dimuat. Menjalankannya sekarang akan melewatkan halaman yang belum masuk."
    : wanted === 0
      ? "Setiap bagian sudah punya usulan atau sudah Anda putuskan."
      : undefined;

  // ONE PARAGRAPH, AND ONLY WHEN IT SAYS SOMETHING THE OPERATOR DOES NOT
  // ALREADY KNOW. The two blocked states say it on the key above instead, so
  // in those the paragraph is absent rather than restating the refusal, and
  // `aria-describedby` has to come off with it or it would point at nothing.
  const detail = searching ? (
    <>
      {startedAt !== null ? (
        <>
          <Elapsed since={startedAt} />{" "}
        </>
      ) : null}
      Biarkan tab ini terbuka sampai selesai.
    </>
  ) : blocked ? null : (
    <>
      <span className="lt-figure">{wanted}</span> bagian belum punya usulan.
      Biarkan tab ini terbuka sampai pembacaan selesai.
    </>
  );

  return (
    <section
      className="border-line flex flex-col gap-4 border-t pt-5"
      aria-labelledby="ingest-process"
    >
      <div className="flex items-center gap-1">
        <h3 id="ingest-process" className="text-[0.9375rem] font-semibold">
          Baca dokumen dengan AI
        </h3>
        <Hint label="Penjelasan pembacaan dengan AI">
          Tiap bagian mendapat satu usulan area, atau tercatat tidak ditemukan.
          Menjalankannya lagi sesudah menambah dokumen hanya mencari bagian yang
          belum ada buktinya.
        </Hint>
      </div>

      {/* Mounted before it has anything to say, so the change of state is
          announced when it happens rather than when the region appears. The
          ticking figure is kept OUT of it on purpose: a seconds counter inside
          a live region is read aloud once per second. The spinner is
          `aria-hidden`, for the same reason. */}
      <div role="status" aria-live="polite">
        {searching ? (
          <p className="text-ink flex items-center gap-3">
            <span className="lt-spinner" data-size="lg" aria-hidden="true" />
            <span>
              AI sedang membaca dokumen ini dan mencari bukti untuk{" "}
              <span className="lt-figure">{wanted}</span> bagian.
            </span>
          </p>
        ) : note ? (
          <Notice>{note}</Notice>
        ) : null}
      </div>

      {/* Safety copy, so never `--ink-3`, and never further from the button
          than this. */}
      {detail ? (
        <p id={why} className="text-ink-2 max-w-[68ch] text-[0.9375rem]">
          {detail}
        </p>
      ) : null}

      <div>
        <Btn
          tone="primary"
          disabled={searching || blocked}
          reason={reason}
          aria-describedby={detail ? why : undefined}
          onClick={onProcess}
        >
          {/* The magnifier over ruled lines: what this leaves behind is a
              found place in the text. It must appear on the outstanding
              panel's re-run button too, or on neither. */}
          <Cari />
          {searching ? "Sedang membaca..." : "Baca dengan AI"}
        </Btn>
      </div>
    </section>
  );
}

const WAKTU = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * `listRuns` builds a run's label in `src/lib/browser/runtime.ts` (`labelFor`)
 * and builds it in English: "(no documents yet)", and "<name> +2 more" for a
 * bundle. That file is not this screen's to edit, and an English string in the
 * operator's own list of work is a defect either way, so the two shapes it
 * emits are translated here.
 *
 * THE REAL FIX IS IN `labelFor`. Delete this the moment it speaks Bahasa.
 */
function runName(label: string): string {
  if (label === "(no documents yet)") return "(belum ada dokumen)";
  return label.replace(/ \+(\d+) more$/, " +$1 berkas lain");
}

/** The file name is shortened from the middle; the "+2 berkas lain" is not. */
function shortenRunName(label: string): string {
  const parts = /^(.*?)( \+\d+ berkas lain)$/.exec(label);
  if (!parts) return shortenFileName(label, 30);
  return `${shortenFileName(parts[1], 24)}${parts[2]}`;
}

/**
 * RIWAYAT: the order already saved on this device.
 *
 * IT IS THE SESSION MANAGER, and calling it that out loud is most of the fix.
 * It was headed "Order tersimpan" in a 19rem rail beside the drop target,
 * and an operator asked whether it was meant to be the session history, which
 * is the question you ask about something that has not said what it is. So it
 * says: one word, one icon, its own kop, at the bottom of the screen where
 * finding an old job belongs.
 *
 * BOTTOM OF MUAT AND NOWHERE ELSE. Beside the drop target it stood at equal
 * weight with "start today's order" for the whole of every session, and those
 * two are not equal: one of them is what the operator came here to do. On any
 * later phase it would be worse still, an invitation to abandon the work in
 * hand. The documents of the OPEN order are the thing that follows the
 * operator everywhere, and that is `DocumentsBar`, which is a different object
 * with a different job.
 *
 * SEARCHABLE AT EVERY ROW COUNT, INCLUDING NONE. The field used to appear
 * only at seven rows, and the argument for that threshold was a real one: a
 * filter over four items is furniture, costing a control, a label and a line
 * of vertical space to save an operator from reading four lines they can
 * already see. The operator has since asked for the field directly, and they
 * are the one who opens this list every day against a device that accumulates
 * orders for as long as nobody clears it.
 *
 * THE ARGUMENT AGAINST ANY THRESHOLD, INCLUDING A THRESHOLD OF ONE, is that
 * the control MOVES. A field that is absent through the first week of use and
 * appears one day is a worse thing to hand somebody than a field they do not
 * need yet, and the count it is gated on is not stable even within one visit:
 * `runs` is empty while storage is still being read, so a gate on "is there a
 * list at all" made the field pop in a beat after the screen drew, taking the
 * rows down with it. It is here whenever the riwayat is, and the empty state
 * below it still says in a sentence that there is nothing saved.
 *
 * THE PLACEHOLDER NAMES WHAT IT ACTUALLY MATCHES, which is the document names
 * and the date AS PRINTED, the only two things a row shows. A field that
 * silently fails on anything else is this project's own failure class in a
 * text input.
 */
function Riwayat({
  runs,
  loading,
  openId,
  onOpenRun,
  onStartNewRun,
}: {
  runs: RunSummary[];
  loading: boolean;
  openId: string | null;
  onOpenRun: (id: string) => void;
  onStartNewRun?: () => void;
}) {
  const [query, setQuery] = useState("");
  const fieldId = useId();

  // Newest first: these are day-to-day work items, and recency is how people
  // actually find them.
  const ordered = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const needle = query.trim().toLowerCase();
  const shown =
    needle
      ? ordered.filter((summary) =>
          `${runName(summary.label)} ${WAKTU.format(summary.createdAt)}`
            .toLowerCase()
            .includes(needle),
        )
      : ordered;

  return (
    <section className="lt-slab" aria-labelledby="ingest-runs">
      <div className="lt-kop">
        <Arsip size={16} />
        <h3 id="ingest-runs">Riwayat order</h3>
        {/* THE COUNT FOLLOWS THE FILTER. A kop reading 14 over two visible
            rows is a small wrong-and-quiet of its own: it reads as a list that
            failed to draw the other twelve rather than as a filter doing its
            job. */}
        <span className="lt-kop-right lt-figure">
          {loading
            ? ""
            : needle
              ? `${shown.length} dari ${ordered.length}`
              : `${ordered.length}`}
        </span>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor={fieldId} className="sr-only">
            Cari order menurut nama berkas atau tanggal
          </label>
          <Cari size={16} />
          <input
            id={fieldId}
            type="search"
            className="lt-input w-full max-w-[28rem]"
            placeholder="Cari nama berkas atau tanggal"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div aria-live="polite">
          {loading ? (
            /* Not "belum ada order" while the list is still being read. A
               returning operator used to be told, briefly but every single
               time, that they had no saved work. */
            <p className="lt-note">Memuat riwayat.</p>
          ) : ordered.length === 0 ? (
            <p className="lt-note">
              Belum ada order tersimpan. Menaruh berkas PDF akan memulai
              satu.
            </p>
          ) : shown.length === 0 ? (
            <p className="lt-note">Tidak ada yang cocok dengan {query}.</p>
          ) : (
            /* A GRID RATHER THAN A COLUMN, because this is no longer in a
               19rem rail. Three across on a wide screen is one screenful of
               history instead of a scroll box holding four rows at a time. */
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((summary) => {
                const open = summary.id === openId;
                const name = runName(summary.label);
                return (
                  <li key={summary.id}>
                    <button
                      type="button"
                      aria-current={open ? "true" : undefined}
                      onClick={() => onOpenRun(summary.id)}
                      data-on={open ? "true" : undefined}
                      className="lt-btn w-full flex-col items-start gap-1 px-4 py-2 text-left"
                    >
                      <span
                        className="lt-figure w-full truncate text-[0.875rem]"
                        title={name}
                      >
                        {shortenRunName(name)}
                      </span>
                      {/* 13px, not 12: nothing in this product is set
                          smaller, because the date is how one order of a
                          customer's paperwork is told from another. */}
                      <span className="text-ink-2 text-[0.8125rem] font-normal">
                        {WAKTU.format(summary.createdAt)}
                        {open ? ", sedang dibuka" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {onStartNewRun ? (
          <div className="flex items-center gap-2">
            <Btn onClick={onStartNewRun}>Mulai order lain</Btn>
            {/* What happens to the order you walk away from: true on every
                run, and the reassurance is worth having exactly once, at the
                moment the hand is on this button. */}
            <Hint label="Penjelasan: Mulai order lain">
              Order yang sekarang tetap tersimpan di perangkat ini dan bisa
              dibuka lagi dari riwayat. Tidak ada keputusan yang hilang.
            </Hint>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function IngestPanel({
  run,
  progress,
  busy,
  error,
  onFiles,
  runs = [],
  runsLoading = false,
  onOpenRun,
  onStartNewRun,
  onProcess,
  searching = false,
  searchStartedAt = null,
  searchNote = null,
  wanted = 0,
}: {
  run: BrowserRun | null;
  progress: IngestProgress | null;
  busy: boolean;
  /**
   * The ingest that just failed, as the runtime reported it. Deployer-facing
   * text: it goes behind `Detail teknis`, never into the sentence the operator
   * is meant to act on.
   */
  error: string | null;
  onFiles: (files: File[]) => void;
  /** The runs list is omitted entirely when the shell does not supply it. */
  runs?: RunSummary[];
  runsLoading?: boolean;
  onOpenRun?: (id: string) => void;
  onStartNewRun?: () => void;
  /** MOVE TWO. Omitted, the block is not offered at all. */
  onProcess?: () => void;
  searching?: boolean;
  /** When the running search started, for the elapsed reading. */
  searchStartedAt?: number | null;
  /** What the last search found, in one sentence. Outlives the search. */
  searchNote?: string | null;
  /** How many bagian the next search would look for. */
  wanted?: number;
}) {
  const pages = run?.pages.length ?? 0;
  // `busy` can lead `progress` by a moment, because the shell sets one before
  // the other. Reading without a name yet is still reading, and an empty
  // screen for that moment reads as a refusal to start.
  const reading: IngestProgress | null =
    progress ?? (busy ? { name: "", done: 0, total: 0 } : null);

  return (
    <div className="flex flex-col gap-6">
      {/* THE HEADING MOVED INTO THE KOP, so it is no longer here. A slab
          whose kop says "Muat dokumen order" with an `<h2>` under it saying
          the same words is the shape a screen takes when a block is wrapped
          rather than designed. The lede went with it: "Berikan semua berkas
          PDF yang datang bersama order ini" is what the drop target's own
          label already says one line further down. */}
      {error ? (
        <Interruption detail={error}>
          {pages > 0
            ? "Pemuatan berhenti sebelum semua halaman selesai. Halaman yang sudah masuk tetap tersimpan, dan order ini tetap ada di daftar. Anda bisa memuat berkas yang sama lagi."
            : "Pemuatan berhenti sebelum satu halaman pun tersimpan. Order yang kosong tetap ada di daftar, jadi Anda bisa mencoba berkas yang sama lagi atau memilih berkas lain."}
        </Interruption>
      ) : null}

      {/* ONE COLUMN NOW. The riwayat used to be a 19rem rail beside the drop
          target, which put "find the job I started yesterday" and "start
          today's" side by side at equal weight for the whole of every session.
          They are not equal: one of them is what the operator came here to do.
          The riwayat is below, under its own kop, where it is found when it is
          wanted and is not competing when it is not. */}
      <section className="lt-slab">
        <div className="lt-kop">
          <Muat size={16} />
          <h2>Muat dokumen order</h2>
          {/* WHAT THE NEXT MOVE IS, WHICH IS THE ONLY PART OF THIS AN
              OPERATOR CAN ACT ON. The straightening and the one-page-at-a-time
              storing used to be printed here; both work whether or not anybody
              reads them, so both are gone rather than tucked away. */}
          <Hint label="Penjelasan langkah Muat">
            Sesudah semua berkas masuk, tombol di bawah menyuruh AI membaca
            dokumen dan mencari bukti untuk tiap bagian.
          </Hint>
          <span className="lt-kop-right lt-figure">
            {pages > 0 ? `${pages} halaman` : ""}
          </span>
        </div>
        <div className="lt-slab-body flex flex-col gap-6">
          {reading ? (
            /* The drop target stands down while an ingest runs. It cannot
               accept anything, and leaving a dead target on screen is the same
               refusal-in-silence the file filter used to make. */
            <Reading progress={reading} />
          ) : (
            /* NEITHER HINT IS PRINTED ANY MORE, and the label carries the one
               difference between them. "Tambahkan berkas ke order ini"
               against "Taruh berkas order di sini" is the whole of what the
               operator needed on screen: whether this drop joins the open
               order or starts one. The reassurances behind it (nothing you
               already accepted changes, rotated scans are straightened) are
               word for word the same on every order. */
            <DocumentDrop
              label={
                pages > 0
                  ? "Tambahkan berkas ke order ini"
                  : "Taruh berkas order di sini"
              }
              explain={
                pages > 0
                  ? "Berkas baru masuk ke order yang sedang terbuka, bukan ke order baru. Halaman yang sudah ada tidak berubah, dan area yang sudah Anda terima tetap utuh."
                  : /* THE OUTCOME, NOT THE MECHANISM. This used to say the
                       rotated scans "akan diluruskan lebih dulu", which is us
                       narrating our own render step. What the operator wants
                       to know before they walk back to the scanner is whether
                       a sideways page is a problem. It is not. */
                    "Semua berkas sekaligus juga bisa. Halaman yang miring atau terputar tetap terbaca."
              }
              /* ONE PRIMARY KEY PER SCREEN. Empty, this target is the only
                 move there is. Once the order holds halaman the move is
                 `Baca dengan AI` in the block below, and this becomes the
                 secondary path for somebody who noticed a missing berkas. */
              tone={pages > 0 ? "default" : "primary"}
              disabled={busy}
              onFiles={onFiles}
            />
          )}

          {run ? <RunContents run={run} /> : null}

          {/* Move two only exists once there is something to process. On the
              empty state the screen stays one invitation with one target. */}
          {onProcess && pages > 0 ? (
            <Process
              wanted={wanted}
              searching={searching}
              startedAt={searchStartedAt}
              note={searchNote}
              busy={busy}
              onProcess={onProcess}
            />
          ) : null}

          {/* THE WAY FORWARD IS NOT BUILT HERE, and the gate it carries is
              worth recording where somebody looks for it.

              A "Buka lembar periksa" button on this block and a "Lanjut:
              Periksa" at the foot of the same screen are one control drawn
              twice, and the operator has to work out whether they do the same
              thing. The timeline and the step nav in `operator-app.tsx` are
              the one mechanism, on every phase, in the same place.

              THE GATE THEY APPLY is on the search having RUN, not on it having
              found everything: a pass that left bagian tidak ditemukan has
              finished, and the top of the lembar periksa is where that is
              settled. A LATER round does not close it again, and the search
              deliberately survives the operator working during it, because it
              re-reads the order from storage and re-checks every slot before
              applying its answer. Nothing was lost in moving the control out
              except the second copy: the locked reason rides on the key
              itself now, through `Btn`'s `reason`. */}
        </div>
      </section>

      {onOpenRun ? (
        <Riwayat
          runs={runs}
          loading={runsLoading}
          openId={run?.id ?? null}
          onOpenRun={onOpenRun}
          onStartNewRun={run ? onStartNewRun : undefined}
        />
      ) : null}
    </div>
  );
}
