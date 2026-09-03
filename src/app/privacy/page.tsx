/**
 * The privacy policy, served by this app.
 *
 * IT EXISTS BECAUSE GOOGLE REQUIRES IT TO PUBLISH THE OAUTH CONSENT SCREEN.
 * The console's own tooltip is explicit: "Valid app name, support email,
 * homepage url, and privacy policy url are required for switching the app to
 * external production mode." Publishing is not optional for this deployment --
 * in Testing mode only accounts on Google's own test-user list may sign in,
 * which would mean an operator has to be added BOTH there (in the Cloud
 * console, by a project member) and to this app's allowlist. The admin page
 * exists precisely so that adding an operator does not require console access,
 * so Testing mode would defeat it.
 *
 * ## This page must stay publicly readable
 *
 * A privacy policy behind a login is not a privacy policy. `/privacy` is
 * therefore excluded from the matcher in `src/proxy.ts`, and this component
 * deliberately does not call the guard. It is the second route after
 * `api/health` to be public, and for a similar reason: the party that needs to
 * read it never carries a session cookie.
 *
 * It renders no image, no icon font and no external stylesheet, for the reason
 * `signin/page.tsx` records at greater length: this project's standing proof is
 * `performance.getEntriesByType("resource")` showing no host but this one, and
 * the cheapest way to keep that true is to leave nothing to fetch. There is no
 * client component here either, so the whole page renders for a reviewer or a
 * link unfurler running no JavaScript at all.
 *
 * ## Keep it TRUE
 *
 * Everything below is a claim about what the code does, and a privacy policy
 * that drifts from the code is worse than none. Three load-bearing sentences:
 *
 *   - The PDF never leaves the device. pdf.js renders it in the tab, the run
 *     lives in IndexedDB, and every evidence crop is cut from the device's own
 *     pixels.
 *   - ONE RENDERED PAGE IMAGE PER PAGE DOES LEAVE, to this app's own
 *     `/api/ocr`, which forwards it to the Gemini API for text recognition.
 *   - Finding a field inside those pages is text only: numbered OCR lines go
 *     up, a line range comes back.
 *
 * IT DESCRIBES THE APP, NOT ITS HISTORY. This page carried a dated sentence
 * about text recognition having moved out of the browser, which is a changelog
 * entry rather than a policy: the product has not launched, so nobody reading
 * it ever used the version being contrasted against, and a reader learning
 * that something USED to be different reasonably wonders which parts of what
 * they are reading are also about to change. A policy states what happens now.
 * When the boundary moves, this page moves with it -- in the same commit,
 * because shipping a route without the edit publishes a false statement about
 * where customer scans go, in two languages, to an OAuth reviewer and to the
 * client's own staff. It says what is true after the move, not that a move
 * happened.
 *
 * ## How it is set
 *
 * A SHEET OF PAPER LYING ON THE TABLE. `docs/design-system.md` allows exactly
 * one lit material, `.lt-paper`, and only for documents: a crop, a rendered
 * page, the sign-in sheet and this one. Everywhere else in this product a
 * person GLANCES at evidence, which is why the work surface is a toned
 * graphite; this is the one page where a person READS, continuously, for
 * several minutes. So the policy is set on paper, at a reading measure, and
 * the graphite is left to be the table it lies on.
 *
 * IT OPENS WITH A KOP, the bar of ink an Indonesian letterhead starts with,
 * carrying the product's name. That is the same object that opens the sign-in
 * sheet and the three failure sheets, so the five paper surfaces in `src/app/`
 * are one thing seen five times. `signin/page.tsx` records the one hazard they
 * share: `.lt-kop` paints `--kop` under `--ink`, and both rebind to
 * `--paper-ink` here, so a kop on paper is ink on ink until its legend is
 * spelled out as `--paper`.
 *
 * Five details that are decisions rather than accidents:
 *
 *   - `--ink` IS REMAPPED TO `--paper-ink` on the sheet, and THAT NOW HAPPENS
 *     IN `globals.css` rather than here. The one global `:focus-visible` rule
 *     draws its outline in `var(--ink)`, which is near-white: right on the
 *     graphite ground and INVISIBLE on paper, so every link on this page had
 *     no visible keyboard focus at all. The rule itself is not overridden (it
 *     is the product's single focus treatment, and forking it per surface is
 *     how a product ends up with three); the sheet supplies the value of ink
 *     that is true for its own ground. `::selection`, which also names
 *     `--ink`, is corrected by the same line. This page used to carry that as
 *     a local `style` on the article, with a note saying it probably belonged
 *     on `.lt-paper`; it now does, on a selector shared with `.lt-denah`, so
 *     the local override is gone rather than silently duplicated.
 *   - THE DATE IS ONE CONSTANT AND MEANS ONE THING: when this policy was last
 *     revised. It was two for a while -- the revision date and the date text
 *     recognition moved off the device -- and the second is gone with the
 *     sentence that needed it. A policy carries the date of its own revision so
 *     a reader can tell whether they have read this version; it does not carry
 *     the dates of the changes that produced it.
 *   - SECTION NUMBERS COME FROM ONE ARRAY, which the contents list and the
 *     headings both read. Numbering a long document by hand in two places is
 *     the same defect as the date, one release later.
 *   - THE ENGLISH SUMMARY MIRRORS THE INDONESIAN SECTIONS and its numerals are
 *     CROSS-REFERENCES into them, not clause numbers of its own. It is a
 *     summary, not a second policy, and it used to be a single twenty-line
 *     paragraph summarising eight titled sections: the reader least able to
 *     read the body was handed the least navigable version of it. It carries
 *     `lang="en"` inside a `lang="id"` document so a screen reader stops
 *     pronouncing it with Indonesian phonemes.
 *   - THE WAY BACK IS `print:hidden`, THE KOP IS NOT. A policy gets archived,
 *     and a printed copy should not carry a link into an app that paper cannot
 *     open. The name of the product it is a policy ABOUT is a different thing:
 *     that is the letterhead, and a policy printed without one names nobody.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export const metadata = {
  title: "Kebijakan Privasi - tv-validator",
  description:
    "Berkas PDF tidak diunggah. Halaman dirender di peramban ini, dan hanya gambar halaman yang dikirim ke server aplikasi untuk dibaca teksnya.",
};

/** When this policy was last revised. */
const UPDATED = "2 September 2026";

const CONTACT = "aisystemtelkom@gmail.com";

/**
 * The document's own structure, in order. The contents list and every heading
 * are rendered from this, so a section cannot be renumbered in one place and
 * left alone in the other.
 */
const SECTIONS = [
  { id: "ringkasan", title: "Ringkasan" },
  { id: "berkas-pdf", title: "Berkas PDF tetap di perangkat Anda" },
  { id: "layanan-model", title: "Yang dikirim ke layanan model bahasa" },
  { id: "data-akun", title: "Data akun" },
  { id: "pelacakan", title: "Pelacakan" },
  { id: "penghapusan-akses", title: "Penghapusan akses" },
  { id: "kontak", title: "Kontak" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const EN_ID = "summary-in-english";

function sectionAt(id: SectionId) {
  const index = SECTIONS.findIndex((section) => section.id === id);
  return { n: index + 1, title: SECTIONS[index].title };
}

/**
 * The measure of the sheet: about 66 characters of body text once the sheet's
 * own padding is taken off, which is the width a long document can be read at
 * without the eye losing the line it is returning to.
 */
const SHEET = "w-full max-w-[42rem]";

/**
 * A numeral: the paper numbering itself, so the mono face, quietly. One step
 * below the body it sits beside, which is what keeps it from competing with
 * the heading it numbers.
 */
const NUMERAL = "lt-figure text-[0.875rem]";

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const { n, title } = sectionAt(id);
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-2">
      {/* `.lt-title` rather than a size of this page's own: it is the system's
          section step, and on paper it takes the sheet's ink from the rebind. */}
      <h2 className="lt-title flex items-baseline gap-2">
        <span className={NUMERAL} style={{ color: "var(--paper-ink-2)" }}>
          {n}
        </span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

/**
 * One item of the English summary, numbered by the Indonesian section it
 * summarises rather than by its own position in the summary.
 */
function EnItem({
  of,
  title,
  children,
}: {
  of: SectionId;
  title: string;
  children: ReactNode;
}) {
  const { n } = sectionAt(of);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-[1rem] leading-snug font-bold">
        <span className={NUMERAL} style={{ color: "var(--paper-ink-2)" }}>
          {n}
        </span>
        <span>{title}</span>
      </h3>
      {children}
    </div>
  );
}

/**
 * An identifier quoted inside prose: an OAuth scope, an address. Mono, because
 * that is the document's own voice.
 *
 * ONE step down from the prose it sits in, and no further: this is the
 * paragraph a Google reviewer reads most carefully, and mono runs optically
 * larger than the sans beside it. It was `0.9375em`, which is a seventh size
 * on a page that has six; `0.875rem` is a real step of the ramp and one this
 * page already sets, on the section numerals.
 */
function Code({ children }: { children: ReactNode }) {
  return (
    <code
      className="lt-figure rounded-[2px] px-2 text-[0.875rem]"
      style={{
        background: "color-mix(in oklch, var(--paper-ink), transparent 92%)",
      }}
    >
      {children}
    </code>
  );
}

/** 2px, because this product has no 1px rule anywhere. */
function Rule() {
  return (
    <hr
      className="border-0 border-t-2"
      style={{ borderColor: "var(--paper-edge)" }}
    />
  );
}

/**
 * What a kop costs on paper, in one place.
 *
 * `.lt-paper` rebinds `--ink` and `--kop` to `--paper-ink`, so `.lt-kop` alone
 * paints ink on ink. `color` carries the bar itself; rebinding `--ink` carries
 * every child that names the token, which is how `.lt-wordmark` stops needing
 * a style of its own. If `globals.css` ever gives `.lt-paper .lt-kop` a
 * legend, this constant goes.
 */
const KOP_ON_PAPER = {
  color: "var(--paper)",
  "--ink": "var(--paper)",
} as CSSProperties;

/**
 * The letterhead.
 *
 * Nothing sits at the right of it. A kop's right-hand side carries the state
 * the block is in, and a policy is not in a state: it is a document. The four
 * sheets that ARE in a state (404, gagal, gagal, memuat) say so there.
 */
function Kop() {
  return (
    <div className="lt-kop" style={KOP_ON_PAPER}>
      <span className="lt-wordmark">tv-validator</span>
    </div>
  );
}

/**
 * The way back into the app, which this page has never had.
 *
 * `prefetch={false}` on purpose: most readers of this page carry no session,
 * `/` is behind the guard, and prefetching it would spend a request on a
 * redirect to the sign-in page that nobody asked for. It still renders a plain
 * `<a href="/">`, so it works for a reader with no JavaScript.
 */
function BackLink() {
  return (
    <Link className="lt-btn" href="/" prefetch={false}>
      Kembali ke aplikasi
    </Link>
  );
}

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-4 px-4 py-12 sm:px-6">
      <div className={`${SHEET} flex justify-end print:hidden`}>
        <BackLink />
      </div>

      <article
        className={`lt-paper ${SHEET} overflow-hidden text-[1rem] leading-[1.75] print:shadow-none`}
      >
        <Kop />

        <div className="lt-slab-body flex flex-col gap-6 p-6 sm:p-12">
          <header className="flex flex-col gap-2">
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.02em]">
              Kebijakan Privasi
            </h1>
            {/* `.lt-lede` rather than a colour of this page's own: it is the
                system's subtitle, and on the sheet it takes `--ink-2` from the
                paper rebind. */}
            <p className="lt-lede">
              tv-validator, alat bantu validasi dokumen order.
            </p>
            {/* A date is a value quoted out of a document, so it is set in a
                ruled box rather than loose in the sentence. `.lt-kotak` fills
                itself with `--surface-sunk`, which is the TABLE's recess and
                stays dark on paper, so the fill is spelled out. */}
            <p
              className="flex items-center gap-2 text-[0.875rem]"
              style={{ color: "var(--paper-ink-2)" }}
            >
              Diperbarui
              <span className="lt-kotak" style={{ background: "transparent" }}>
                {UPDATED}
              </span>
            </p>
          </header>

          {/* The one thing anyone opens this page to find out, above the
              contents and above section 1. It used to be the second section,
              split across three paragraphs. The wording is the sentence
              docs/ui-bahasa.md fixes for this claim, plus the onward hop it
              does not cover. It is set one step up, so the sheet has one thing
              on it that is plainly the point. */}
          <p
            className="border-l-2 pl-4 text-[1.25rem] leading-[1.6]"
            style={{ borderColor: "var(--paper-ink)" }}
          >
            Berkas PDF tidak diunggah. Halaman dirender di peramban ini, dan
            hanya gambar halaman yang dikirim ke server aplikasi untuk dibaca
            teksnya. Server aplikasi meneruskannya ke Google Gemini API.
          </p>

          <nav
            aria-label="Isi halaman"
            className="flex flex-col gap-2 border-y-2 py-4"
            style={{ borderColor: "var(--paper-edge)" }}
          >
            <p
              className="text-[0.8125rem] font-semibold"
              style={{ color: "var(--paper-ink-2)" }}
            >
              Isi halaman
            </p>
            <ol className="flex flex-col gap-2">
              {SECTIONS.map((section, index) => (
                <li key={section.id} className="flex items-baseline gap-2">
                  <span
                    className={NUMERAL}
                    style={{ color: "var(--paper-ink-2)" }}
                  >
                    {index + 1}
                  </span>
                  <a
                    className="underline underline-offset-4"
                    href={`#${section.id}`}
                  >
                    {section.title}
                  </a>
                </li>
              ))}
              <li className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={NUMERAL}
                  style={{ color: "var(--paper-ink-2)" }}
                >
                  EN
                </span>
                <a
                  className="underline underline-offset-4"
                  href={`#${EN_ID}`}
                  lang="en"
                >
                  Summary in English
                </a>
              </li>
            </ol>
          </nav>

          <div className="flex flex-col gap-12">
            <Section id="ringkasan">
              <p>
                Aplikasi ini dipakai secara internal oleh staf yang diberi izin
                untuk menyusun dokumen validasi dari berkas order hasil
                pemindaian. Aplikasi tidak terbuka untuk umum, tidak menayangkan
                iklan, dan tidak menjual data kepada siapa pun.
              </p>
            </Section>

            <Section id="berkas-pdf">
              <p>
                Berkas PDF yang Anda buka tidak pernah diunggah. Pembacaan dan
                perenderan halaman berjalan di dalam peramban Anda, hasil kerja
                disimpan pada penyimpanan lokal peramban (IndexedDB) di komputer
                Anda sendiri, dan pemotongan gambar bukti dilakukan dari piksel di
                perangkat Anda. Tidak ada berkas PDF yang disimpan di server
                aplikasi ini maupun di layanan penyimpanan awan.
              </p>
              <p>
                <strong>Yang dikirim keluar adalah gambar halaman.</strong> Untuk
                setiap halaman, aplikasi mengirimkan satu gambar halaman hasil
                render ke server aplikasi ini, dan server meneruskannya ke
                Google Gemini API untuk dibaca teksnya. Yang kembali adalah
                baris-baris teks beserta koordinatnya. Google bertindak sebagai
                pemroses untuk keperluan ini, atas keputusan pemilik proses.
              </p>
              <p>
                Menghapus data situs pada peramban akan menghapus dokumen dan
                hasil kerja Anda secara permanen, karena tidak ada salinan lengkap
                di tempat lain.
              </p>
            </Section>

            <Section id="layanan-model">
              <p>
                Ada dua jenis kiriman, dan keduanya melalui server aplikasi ini:
              </p>
              <p>
                <strong>Pertama, gambar halaman untuk pengenalan teks.</strong>{" "}
                Satu gambar per halaman dikirim ke Google Gemini API, dan
                jawabannya adalah teks yang terbaca beserta kotak koordinatnya.
              </p>
              <p>
                <strong>
                  Kedua, teks hasil pengenalan untuk mencari letak data.
                </strong>{" "}
                Pada tahap ini aplikasi mengirimkan baris-baris teks bernomor,
                bukan gambar, lalu menerima jawaban berupa rentang baris.
                Pemotongan gambar bukti tetap dilakukan di perangkat Anda
                berdasarkan koordinat baris tersebut.
              </p>
              <p>
                Google bertindak sebagai pemroses untuk keperluan inferensi ini.
                Permintaan dikirim dari server aplikasi, bukan langsung dari
                peramban Anda, dan kredensial API tidak pernah dikirim ke
                peramban.
              </p>
            </Section>

            <Section id="data-akun">
              <p>
                Saat masuk dengan Akun Google, aplikasi meminta izin dasar:{" "}
                <Code>openid</Code>, <Code>email</Code>, dan <Code>profile</Code>.
                Yang disimpan aplikasi hanya alamat email Anda beserta perannya,
                sebagai daftar siapa saja yang boleh masuk. Aplikasi tidak membaca
                Gmail, Drive, Kontak, atau layanan Google lainnya, dan tidak
                menyimpan token akses jangka panjang.
              </p>
              <p>
                Sesi disimpan dalam cookie bertanda tangan yang berlaku 12 jam.
              </p>
            </Section>

            <Section id="pelacakan">
              <p>
                Tidak ada analitik pihak ketiga, tidak ada cookie iklan, dan tidak
                ada pelacak. Halaman aplikasi hanya memuat sumber daya dari domain
                aplikasi ini sendiri.
              </p>
            </Section>

            <Section id="penghapusan-akses">
              <p>
                Administrator dapat menghapus alamat email dari daftar izin kapan
                saja; akses berhenti dalam waktu paling lama 60 detik. Anda juga
                dapat mencabut izin aplikasi melalui halaman Akun Google Anda.
              </p>
            </Section>

            <Section id="kontak">
              <p>
                Pertanyaan mengenai kebijakan ini dapat dikirim ke{" "}
                <a
                  className="lt-figure underline underline-offset-4"
                  href={`mailto:${CONTACT}`}
                >
                  {CONTACT}
                </a>
                .
              </p>
            </Section>
          </div>

          <Rule />

          <section id={EN_ID} className="flex scroll-mt-6 flex-col gap-6">
            <div className="flex flex-col gap-2">
              {/* `.lt-title`, the same step every numbered section takes: this
                  is a peer of them, not a smaller thing. */}
              <h2 className="lt-title" lang="en">
                Summary in English
              </h2>
              <p
                className="text-[0.875rem]"
                style={{ color: "var(--paper-ink-2)" }}
              >
                Ringkasan bagian 1 sampai 7 di atas, untuk pembaca yang tidak
                berbahasa Indonesia. Teks lengkapnya adalah bagian 1 sampai 7 itu
                sendiri, dan nomor di bawah menunjuk ke sana.
              </p>
            </div>

            <div className="flex flex-col gap-6" lang="en">
              <EnItem of="ringkasan" title="What this tool is">
                <p>
                  An internal tool for authorised staff, used to assemble
                  validation documents from scanned order files. It is not open to
                  the public, it carries no advertising, and it sells data to
                  nobody.
                </p>
              </EnItem>

              <EnItem of="berkas-pdf" title="Your PDF files stay on your device">
                <p>
                  Your PDF files are never uploaded: they are rendered in your
                  browser, the run is held in that browser&apos;s local storage
                  (IndexedDB) on your own computer, and evidence crops are cut
                  from your own device&apos;s pixels. No PDF is stored on this
                  application&apos;s server or in cloud storage. Clearing your
                  browser&apos;s site data deletes your documents and your work
                  permanently, because no complete copy exists anywhere else.
                </p>
              </EnItem>

              <EnItem
                of="layanan-model"
                title="What is sent to the language model service"
              >
                <p>
                  What does leave your device, one page at a time, is a{" "}
                  <em>rendered page image</em>. Each page image is sent to this
                  application&apos;s own server, which forwards it to the Google
                  Gemini API and returns the recognised text with its
                  coordinates. The later step that locates a field sends OCR{" "}
                  <em>text</em> (numbered lines) only, and a line range comes
                  back; the crop is still cut on your device. Google acts as a
                  processor for this inference. Requests are made from the server,
                  not from your browser, and the API credential never reaches the
                  browser.
                </p>
              </EnItem>

              <EnItem of="data-akun" title="Account data">
                <p>
                  Signing in uses the basic <Code>openid email profile</Code>{" "}
                  scopes; the only account data stored is your email address and
                  its role, used as the access list. No Gmail, Drive or Contacts
                  access, and no long-lived access tokens are kept. Sessions are
                  held in a signed cookie and last 12 hours.
                </p>
              </EnItem>

              <EnItem of="pelacakan" title="Tracking">
                <p>
                  No third-party analytics, advertising cookies or trackers. Pages
                  load resources only from this application&apos;s own domain.
                </p>
              </EnItem>

              <EnItem of="penghapusan-akses" title="Removing access">
                <p>
                  An administrator can remove your address from the allowlist at
                  any time, effective within 60 seconds. You can also revoke this
                  application&apos;s access from your Google Account page.
                </p>
              </EnItem>

              <EnItem of="kontak" title="Contact">
                <p>
                  Questions about this policy:{" "}
                  <a
                    className="lt-figure underline underline-offset-4"
                    href={`mailto:${CONTACT}`}
                  >
                    {CONTACT}
                  </a>
                  .
                </p>
              </EnItem>
            </div>
          </section>
        </div>
      </article>

      <div className={`${SHEET} print:hidden`}>
        <BackLink />
      </div>
    </main>
  );
}
