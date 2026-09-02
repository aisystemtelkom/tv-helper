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
 * the cheapest way to keep that true is to leave nothing to fetch.
 *
 * ## Keep it TRUE
 *
 * Everything below is a claim about what the code does, and a privacy policy
 * that drifts from the code is worse than none. The load-bearing sentences are
 * now narrower than they were, and the narrowing is the point:
 *
 *   - The PDF still never leaves the device. pdf.js renders it in the tab, the
 *     run lives in IndexedDB, and every evidence crop is cut from the device's
 *     own pixels.
 *   - ONE RENDERED PAGE IMAGE PER PAGE DOES LEAVE, to this app's own
 *     `/api/ocr`, which forwards it to the Gemini API for text recognition.
 *     That is new as of 2026-09-02 and it replaced on-device OCR.
 *   - Finding a field inside those pages is still text only: numbered OCR
 *     lines go up, a line range comes back.
 *
 * This page was rewritten in the same commit as `src/app/api/ocr/route.ts`,
 * deliberately. Shipping that route without this edit would have published a
 * dated, false statement about where customer scans go, in two languages, to
 * an OAuth reviewer and to the client's own staff. If the boundary moves
 * again, this page moves with it in the same commit.
 */

export const metadata = {
  title: "Kebijakan Privasi - tv-validator",
};

const UPDATED = "2 September 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Kebijakan Privasi</h1>
        <p className="text-sm text-neutral-600">
          tv-validator, alat bantu validasi dokumen order. Diperbarui {UPDATED}.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Ringkasan</h2>
        <p className="text-sm leading-6">
          Aplikasi ini dipakai secara internal oleh staf yang diberi izin untuk
          menyusun dokumen validasi dari berkas order hasil pemindaian.
          Aplikasi tidak terbuka untuk umum, tidak menayangkan iklan, dan tidak
          menjual data kepada siapa pun.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          Berkas PDF tetap di perangkat Anda
        </h2>
        <p className="text-sm leading-6">
          Berkas PDF yang Anda buka tidak pernah diunggah. Pembacaan dan
          perenderan halaman berjalan di dalam peramban Anda, hasil kerja
          disimpan pada penyimpanan lokal peramban (IndexedDB) di komputer Anda
          sendiri, dan pemotongan gambar bukti dilakukan dari piksel di
          perangkat Anda. Tidak ada berkas PDF yang disimpan di server aplikasi
          ini maupun di layanan penyimpanan awan.
        </p>
        <p className="text-sm leading-6">
          <strong>Yang dikirim keluar adalah gambar halaman.</strong> Sejak 2
          September 2026 pengenalan teks (OCR) tidak lagi berjalan di peramban.
          Untuk setiap halaman, aplikasi mengirimkan satu gambar halaman hasil
          render ke server aplikasi ini, dan server meneruskannya ke Google
          Gemini API untuk dibaca teksnya. Yang kembali adalah baris-baris teks
          beserta koordinatnya. Perubahan ini dilakukan atas keputusan pemilik
          proses, setelah penilaian mereka sendiri terhadap Google sebagai
          pemroses.
        </p>
        <p className="text-sm leading-6">
          Menghapus data situs pada peramban akan menghapus dokumen dan hasil
          kerja Anda secara permanen, karena tidak ada salinan lengkap di tempat
          lain.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          Yang dikirim ke layanan model bahasa
        </h2>
        <p className="text-sm leading-6">
          Ada dua jenis kiriman, dan keduanya melalui server aplikasi ini:
        </p>
        <p className="text-sm leading-6">
          <strong>Pertama, gambar halaman untuk pengenalan teks.</strong> Satu
          gambar per halaman dikirim ke Google Gemini API, dan jawabannya adalah
          teks yang terbaca beserta kotak koordinatnya.
        </p>
        <p className="text-sm leading-6">
          <strong>Kedua, teks hasil pengenalan untuk mencari letak data.</strong>{" "}
          Pada tahap ini aplikasi mengirimkan baris-baris teks bernomor, bukan
          gambar, lalu menerima jawaban berupa rentang baris. Pemotongan gambar
          bukti tetap dilakukan di perangkat Anda berdasarkan koordinat baris
          tersebut.
        </p>
        <p className="text-sm leading-6">
          Google bertindak sebagai pemroses untuk keperluan inferensi ini.
          Permintaan dikirim dari server aplikasi, bukan langsung dari peramban
          Anda, dan kredensial API tidak pernah dikirim ke peramban.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Data akun</h2>
        <p className="text-sm leading-6">
          Saat masuk dengan Akun Google, aplikasi meminta izin dasar:{" "}
          <code className="text-xs">openid</code>,{" "}
          <code className="text-xs">email</code>, dan{" "}
          <code className="text-xs">profile</code>. Yang disimpan aplikasi hanya
          alamat email Anda beserta perannya, sebagai daftar siapa saja yang
          boleh masuk. Aplikasi tidak membaca Gmail, Drive, Kontak, atau layanan
          Google lainnya, dan tidak menyimpan token akses jangka panjang.
        </p>
        <p className="text-sm leading-6">
          Sesi disimpan dalam cookie bertanda tangan yang berlaku 12 jam.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Pelacakan</h2>
        <p className="text-sm leading-6">
          Tidak ada analitik pihak ketiga, tidak ada cookie iklan, dan tidak ada
          pelacak. Halaman aplikasi hanya memuat sumber daya dari domain
          aplikasi ini sendiri.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Penghapusan akses</h2>
        <p className="text-sm leading-6">
          Administrator dapat menghapus alamat email dari daftar izin kapan
          saja; akses berhenti dalam waktu paling lama 60 detik. Anda juga dapat
          mencabut izin aplikasi melalui halaman Akun Google Anda.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Kontak</h2>
        <p className="text-sm leading-6">
          Pertanyaan mengenai kebijakan ini dapat dikirim ke{" "}
          <a className="underline" href="mailto:aisystemtelkom@gmail.com">
            aisystemtelkom@gmail.com
          </a>
          .
        </p>
      </section>

      <hr className="border-neutral-200" />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Summary in English</h2>
        <p className="text-sm leading-6">
          Internal tool for authorised staff. Your PDF files are never uploaded:
          they are rendered in your browser and the run is held in that
          browser&apos;s local storage, and evidence crops are cut from your own
          device&apos;s pixels. What does leave your device, one page at a time,
          is a <em>rendered page image</em>: since 2 September 2026 text
          recognition no longer runs in the browser, so each page image is sent
          to this application&apos;s own server, which forwards it to the Google
          Gemini API and returns the recognised text with its coordinates. The
          later step that locates a field sends OCR <em>text</em> (numbered
          lines) only, and a line range comes back. Signing in uses the basic{" "}
          <code className="text-xs">openid email profile</code> scopes; the only
          account data stored is your email address and its role, used as the
          access list. No Gmail, Drive or Contacts access. No third-party
          analytics, advertising cookies or trackers. Sessions last 12 hours. An
          administrator can remove your access at any time, effective within 60
          seconds. Contact{" "}
          <a className="underline" href="mailto:aisystemtelkom@gmail.com">
            aisystemtelkom@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
