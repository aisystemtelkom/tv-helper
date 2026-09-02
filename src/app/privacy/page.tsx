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
 * that documents stay on the device and that only OCR text -- never a page
 * image -- reaches the model on the validator path. If either stops being true,
 * this page is part of that change. See "THE COMMON PATH SENDS TEXT, NOT
 * IMAGES" in AGENTS.md.
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
          Dokumen Anda tidak diunggah
        </h2>
        <p className="text-sm leading-6">
          Berkas PDF yang Anda buka tetap berada di perangkat Anda. Proses
          konversi halaman, perenderan gambar, dan pengenalan teks (OCR)
          seluruhnya berjalan di dalam peramban Anda. Hasilnya disimpan pada
          penyimpanan lokal peramban (IndexedDB) di komputer Anda sendiri.
          Tidak ada berkas dokumen yang dikirim ke server aplikasi ini maupun
          disimpan di layanan penyimpanan awan.
        </p>
        <p className="text-sm leading-6">
          Menghapus data situs pada peramban akan menghapus dokumen dan hasil
          kerja Anda secara permanen, karena tidak ada salinan di tempat lain.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          Yang dikirim ke layanan model bahasa
        </h2>
        <p className="text-sm leading-6">
          Untuk menemukan letak sebuah data di dalam dokumen, aplikasi
          mengirimkan <strong>teks hasil OCR</strong> berupa baris-baris
          bernomor ke Google Gemini API, lalu menerima jawaban berupa rentang
          baris. Gambar halaman tidak ikut dikirim pada alur ini. Pemotongan
          gambar bukti dilakukan di perangkat Anda berdasarkan koordinat baris
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
          Internal tool for authorised staff. Your PDF documents are never
          uploaded: page rendering and OCR run entirely in your browser and the
          results are held in that browser&apos;s local storage. To locate a
          field, OCR <em>text</em> (numbered lines) is sent to the Google Gemini
          API and a line range comes back; page images are not sent on this
          path, and cropping happens on your device. Signing in uses the basic{" "}
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
