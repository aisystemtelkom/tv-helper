# The operator UI speaks Bahasa Indonesia

The operators are Telkom staff reading Indonesian documents, and the domain
vocabulary is Indonesian throughout: dokumen tambahan, jenis order, Berita
Acara, Perjanjian Kerjasama, Surat Penunjukan, tanda tangan, paraf. An English
shell around Indonesian content is the wrong way round.

This applies to the operator UI (`src/app/**`, `src/components/**`): screen
copy, labels, status wording, errors, buttons, empty states. It does NOT apply
to code, identifiers, comments, commit messages, `AGENTS.md` or the specs,
which stay in English.

Two things are NOT translations to invent, because they are transcribed from
the human-authored sample and must match it: the DOKUMEN VALIDASI section
titles (`BA Permintaan`, `SP`, `KB`, `KB (lanjutan)`, `Konfigurasi (Excel dari
EPIC)`, `Konfigurasi`, `Email`, `MOM`, `BA Splitting`, `SBR Pricing`, `BASO`,
`BA Penjelasan Order`) and the slot labels inside them (`Nomor`, `Para Pihak`,
`Tanggal`, `Jangka Waktu`, `Detail`, `ToP`, `TTD Pejabat`, `SID`, `Price & SA`,
`BW`, `BA`). Likewise the header fields: `ID EPIC`, `Nama Proyek`, `Quote`,
`CC`, `Order`, `Jenis Order`.

## Tone

Sentence case. Active voice. Address the operator as **Anda**. Say what a
button does, not what the system does. Never apologise, never be vague about
what happened. An empty screen is an invitation to act, not a mood.

**No em dashes anywhere.** Use commas, colons, parentheses, or two sentences.
For an empty cell write `(belum diisi)`, never a lone dash.

An action keeps the same word through the whole flow: the button that says
**Terima** produces the state **Diterima**.

## Two voices, and a rename does not change which is which

The mono face is the DOCUMENT's voice and the sans is the app's. Judul titles
and bagian labels are transcriptions of the operator's paperwork, so they are
mono. Nothing offered to rename them until an order could carry its own form,
and the rule survives that intact:

1. **A judul title and a bagian label are mono, before and after a rename.** A
   renamed judul is still a quotation; it quotes a different order's paperwork.
2. **The input the operator types a name into is mono.** `.lt-input` is set in
   `--font-figure` for exactly this: they are writing in the document's voice,
   and what they type is printed as a heading in the DOKUMEN VALIDASI.
3. **Everything the app says around it is sans, at 13px or larger.** Keys
   (`Ganti nama`, `Simpan`, `Batal`), field labels (`Judul`, `Nama bagian`),
   the helper under the field, and the confirmation sentences.
4. **A quoted name inside an app sentence stays mono.** "Hapus judul X?" is
   the app asking, so the sentence is sans and X is not.
5. **The app never invents a name.** Rename is seeded with what is already
   there; `Tambah judul` starts EMPTY behind the placeholder *"Salin judul dari
   halaman"*, which says where the words come from: the document in front of
   them. A heading the app made up is a heading nobody transcribed.

## Glossary

The whole UI must use one word per concept. Pick from this table, do not
improvise a synonym.

| Concept | Bahasa | Notes |
| --- | --- | --- |
| a run (one order being worked) | **order** | "Belum ada order yang dibuka". It WAS `pekerjaan`, and the operator's objection was that the word "sounds soo awkward" next to how they actually think: one session is one order. The collision is real and deliberate: the packet's header table has a row transcribed as `Order` and another as `Jenis Order`, so the word now names both the session and a field on it. Context separates them, because the field only ever appears inside a quoted table set in the mono voice, and the session only ever appears in the app's own voice. If that stops being true, the field keeps the name and the session gives it up |
| a slot (one cell needing evidence) | **bagian** | |
| a section (one heading of the packet, WITH the bagian under it) | **judul** | one heading of the DOKUMEN VALIDASI together with everything filed beneath it. NEVER "bagian", which is one cell needing evidence: `KB` is a judul and `Nomor` is a bagian inside it. The word was needed the day a section became something an order could rename, move, hide and add, because until then a section had no operator-facing name at all. The manual register's kop counts **judul**, not bagian, for the same reason |
| a judul this order is not printing | **disembunyikan dari order ini** | a judul the FORM declares that this order took out. It is hidden rather than deleted: the form still declares it, the row is at the foot of the lembar periksa, and **Kembalikan** brings the NAME back. It never promises the potongan back, because removing the judul dropped them |
| a zone (the rectangle) | **area** | |
| a crop (the cut picture) | **potongan** | |
| evidence | **bukti** | |
| a proposal from the model | **usulan** | |
| the citation | **sumber** | file, page, lines, size |
| source file | **berkas** | never "file" |
| page | **halaman** | abbreviate as `hal` only inside a citation |
| line / lines | **baris** | |
| size | **ukuran** | |
| whole-page capture | **tangkapan satu halaman** | |
| a continuation capture | **lanjutan** | the REST of one bagian's evidence, carried onto the next page by a page break. Never a second field: the sample's two ToP pictures are items 1-3 and items 4-5 of one Pasal. The template already uses the word in its section titles, so the UI uses no synonym -- not "sambungan", not "bagian kedua" |
| no continuation was found | **diperiksa, tidak ada lanjutan** | said only when a search actually looked past that potongan's page bottom |
| nothing has looked yet | **belum diperiksa lanjutannya** | the opposite, and it must never read as finished. A lanjutan is discovered, not declared, so a bagian nobody has looked past is not known to be complete |
| region within a page | **area di dalam halaman** | |
| the review sheet | **lembar periksa** | |
| additional document | **dokumen tambahan** | the client's own term, keep it |
| round (of tambahan) | **putaran** | |
| the deliverable | **berkas hasil** | ONE file, the DOKUMEN VALIDASI docx. It was two until the EPIC workbook was dropped as a miscommunication, so any copy still saying "kedua berkas" is stale |
| berkas handed over and not yet read | **antrean** | the operator may keep handing berkas over while one is being read, so the ones waiting are a real object on the Muat screen with a heading of their own ("Menunggu giliran") and a row each. Never "daftar tunggu" and never "queue" |
| a berkas the order will not take | **tidak dimuat** | said of a duplicate, and the sentence always names the berkas it repeats, because identity is the CONTENT and the two names are routinely different |
| a berkas ANOTHER order on this device already holds | **sudah pernah dipakai di order lain di perangkat ini** | a NOTICE, never a refusal, and never **tidak dimuat**: the berkas IS loaded, because one customer's documents legitimately recur across their orders. The sentence names what that order calls the file and when it was made, and links to the order in a new tab ("Buka order itu di tab baru"). "Di perangkat ini" is not decoration: orders live in this browser and nowhere else, so a silence must never read as "never used anywhere" |
| the AI may propose out of this berkas | **dibaca AI** | THE DEFAULT FOR EVERY BERKAS, and a berkas nobody has decided anything about wears it. The key that carries it is selected and petrol, never amber: no decision is owed here |
| the AI may not propose out of this berkas | **tanpa AI** | NEVER "gagal", never "dilewati", never "tidak ditemukan". The berkas IS still read -- every halaman is rendered, recognised, counted and drawn as a denah, and the operator can still cut a potongan out of it by hand and cite its baris. What stops is the model proposing. The sentence that rides under it says the doing half first: "Halaman berkas ini tetap terbaca dan bisa Anda potong sendiri, tapi AI tidak mencari apa pun di dalamnya." A bagian in such an order is still honestly **belum dicari** or **tidak ditemukan**; the fence is reported once, by name, at the head of the lembar periksa, and steals none of those words |

## Konfig Excel and Input EPIC

The words the konfigurasi checks added. `konfigurasi` is the operator's EPIC
order-configuration workbook, which they hand over and get back amended; it is
NOT the packet's judul `Konfigurasi (Excel dari EPIC)`, which is a whole-page
capture of an EPIC screen and is evidence rather than an input.

| Concept | Bahasa | Exact meaning |
| --- | --- | --- |
| the EPIC order-configuration workbook | **konfigurasi** | the file itself is **berkas konfigurasi**. Never "excel" in a sentence the operator reads: the app names documents by what they are for |
| one field of the workbook | **isian** | one name and the cell that holds its value. The workbook's own `Isi` instruction is where the word comes from, which is why it is not "kolom" (a column is many isian) or "baris" (reserved for OCR lines) |
| which cell an isian lives in | **sel** | always mono, always the real address (`E9`), and it is the workbook's half of a **sumber**. An operator checking a recommendation opens their own file at that address |
| the scans agree with the workbook | **cocok** | |
| the scans say something else | **belum sesuai** | on screen. An empty cell the scans can fill wears the same word, because the operator's move is the same. Never "salah": the workbook may well be right and the scan misread |
| how the two values differ | **bedanya** | the third row of the register, under `konfigurasi` and `dokumen`. It NAMES a difference and never claims to be the only one, because the ladder in `src/lib/config/difference.ts` is cumulative and the band in the values above shows the rest. Four words and no more: **spasi**, **huruf besar-kecil**, **tanda baca**, **penulisan angka, nilainya sama**. A pair the tool cannot prove is one value gets no word at all, which is most of them |
| searched the scans, not there | **tidak ditemukan** | unchanged, and still fixed to mean SEARCHED AND NOT FOUND. It is the only verdict the one re-search is offered for |
| take the recommendation | **Terima** | produces **Diterima**, the same pair the potongan keys use |
| keep what the workbook says | **Tolak** | produces **Ditolak**. NOT "Bukan ini", which belongs to a potongan: there is no picture here to reject |
| type a value yourself | **Ketik sendiri** | matches **Gambar sendiri**. The field opens seeded with what is there, because the app never invents a value |
| spend the one re-search | **Cari sekali lagi** | once spent: *"Pencarian ulang hanya sekali untuk tiap order."* The cap is the client's, and it is on the order rather than on the tab so a reload does not refill it |
| the amended workbook | **konfigurasi terbaru** | the operator's own file with the accepted cells changed. Never "konfigurasi baru": nothing was authored |
| a screen capture of EPIC | **tangkapan layar EPIC** | any number of them. They are read for their text only; no halaman is made of them and nothing is cropped out of them |
| EPIC shows something the workbook has no isian for | **tidak ada di konfigurasi** | NEVER "tidak ditemukan", which is reserved for the other direction. This is a finding ABOUT the workbook, and the operator's move is to add the isian, not to fetch another document |
| the list of everything still wrong at the end | **ringkasan** | the client asked for it by name. It counts, it names, and every line in it goes to the isian it is about |

## The phases

| # | English | Bahasa | Section headings on the step |
| --- | --- | --- | --- |
| 1 | Order documents | **Berkas Order** | "Muat dokumen order", then "Periksa usulan" below it |
| 2 | Export | **Checkpoint** | "Buat berkas hasil" |
| 3 | Config check | **Konfig Excel** | "Cocokkan konfigurasi dengan dokumen" |
| 4 | EPIC check | **Input EPIC** | "Cocokkan EPIC dengan konfigurasi" |

**The four names are the client's, and none of them is translated or numbered.**
"Checkpoint", "Konfig Excel" and "Input EPIC" mix English into a Bahasa
interface on purpose: they are proper nouns for stages of the client's own
process, like `BA Permintaan` or `ID EPIC`. For one day the last three were
"Checkpoint 1/2/3" and the client corrected that on 2026-09-10; a copy that
still says "Checkpoint 2" is stale.

**BERKAS ORDER IS WHAT MUAT AND PERIKSA WERE, ON ONE PAGE.** The upload section
comes first, and the whole lembar periksa appears below it once `Baca dengan AI`
has run. So **Muat** and **Periksa** survive as the verbs they always were --
"Muat dokumen order" is the upload section's heading and "lembar periksa" is
still the review sheet -- but never as the name of a STEP. A sentence sending
the operator somewhere says **di langkah Berkas Order**, never "di langkah
Muat", and a pointer to the review now says it is **di bawah**, because it is
on the same page, further down.

**Tambahan is not in this table and has not been since the rehaul.** It was a
phase of its own; the dokumen tambahan question is now the head of the lembar
periksa, and answering "yes" opens the ingest drop in a dialog.

## The six slot states

The state name and the verb that produced it must match.

| Code | Bahasa | Means |
| --- | --- | --- |
| `pending` | **belum dicari** | nothing has looked for it yet |
| `proposed` | **perlu diputuskan** | a usulan is waiting on you |
| `confirmed` | **diterima** | you looked and accepted it |
| `partial` | **sebagian** | some captures of this bagian are filled, some are not |
| `outstanding` | **tidak ditemukan** | searched, no evidence found |
| `unfilled` | **sengaja dikosongkan** | you decided it ships empty |

And one word for a blank that is none of the six, on the outstanding block:
**belum digambar**, for a bagian under a judul the operator added themselves.
Nothing will ever search it (`isSearchable` is false for every bagian under an
added judul), so it is not "tidak ditemukan", which is fixed above to mean
SEARCHED AND NOT FOUND. Reporting it that way told the operator, on every
reading pass for ever, that the tool had hunted for something nobody asked it
about, in the one place they go to decide whether to fetch another document.

## Verbs

| English | Bahasa |
| --- | --- |
| Accept | **Terima** |
| Accept all N in X | **Terima semua N di X** |
| Redraw | **Gambar ulang** |
| Not this | **Bukan ini** |
| Draw it by hand | **Gambar sendiri** |
| Ship empty | **Kosongkan** |
| Reopen | **Buka lagi** |
| Rename (a judul, or a bagian) | **Ganti nama** |
| Move one place up the packet | **Naikkan** |
| Move one place down the packet | **Turunkan** |
| Take a judul out of this order | **Hapus judul** |
| Delete it with the crops it holds | **Hapus judul dan N potongannya** |
| Add a judul this order has | **Tambah judul** |
| Put a hidden judul back | **Kembalikan** |
| Undo what a toast just announced, beside it | **Batalkan** |
| Save a name | **Simpan** |
| Undo, review again | **Batalkan, periksa lagi** |
| Choose PDFs | **Pilih berkas PDF** |
| Resume loading | **Lanjutkan pemuatan** |
| Search for these slots | **Cari bagian ini** |
| Cancel | **Batal** |
| Use this zone | **Pakai area ini** |
| Snap to lines | **Kunci ke baris** |
| Build the file | **Buat berkasnya** |
| Save `<name>` | **Simpan `<name>`** |
| Back to the review sheet | **Kembali ke lembar periksa** |
| Start a different run | **Mulai order lain** |
| Sign in with Google | **Masuk dengan Google** |
| Sign out | **Keluar** |

## What the interface never says

The operator is not the audience for our engineering. They are not tech-savvy,
they are trying to finish an order, and every sentence explaining how the
product works stands between them and that. An operator put it plainly:
*"User don't need to learn that we're compliant when they're trying to use each
functionality of the app."*

So the interface does not say, anywhere in the flow:

- **Where anything runs.** Not that pages are rendered in the browser, not that
  text goes to a server, not what forwards it where.
- **How much work it is.** Not "teks 29 halaman", not a token count. A page
  count as a measure of effort also makes the product look slow at the exact
  moment it is working, which is how *"membuka berkas dan menghitung
  halamannya"* came to be replaced: counting pages sounds instant and is not.
- **That we are compliant.** A privacy claim is a promise to the person whose
  documents these are, and it is kept in `/privacy` where it can be read in
  full. Sentences were deleted from the flow ON THAT PAGE'S CREDIT, so the
  policy has to keep carrying them.
- **What a verb does to our internals.** `Proses` was one word for one action
  and it meant nothing to the person reading it: it can name any process. A
  control says what it does to the operator's document.

Three things look like the above and stay, because each is something the
operator must act on rather than something we are explaining about ourselves:

1. The deployment band saying the app is running with no account check. That is
   a live security condition.
2. Any refusal, fault, or interruption.
3. The export-blocked sentence below, which is the argument the product exists
   to make.

And one short fact stays, because the operator asked for it in the same breath
as asking for the explanation to go: **"Berkas PDF tidak diunggah."** They want
to know their file is not being uploaded. They do not want the paragraph after
it.

## Sentences worth getting right

These carry the product's whole argument, so they are written here once rather
than improvised per screen.

- Export is blocked:
  **"{n} usulan masih menunggu keputusan Anda. Tidak ada berkas yang dibuat
  sebelum setiap area diperiksa, karena potongan yang belum diperiksa di dalam
  dokumen yang ditandatangani adalah persis kegagalan yang dicegah langkah
  ini."**
- Documents stay on the device:
  **"Berkas PDF tidak diunggah. Halaman dirender di peramban ini, dan hanya
  gambar halaman yang dikirim ke server aplikasi untuk dibaca teksnya."**
- A slot that ships empty on purpose:
  **"Dikosongkan atas keputusan Anda, bukan karena terlewat."**
- Nothing outstanding:
  **"Tidak ada yang tersisa. Setiap bagian yang bisa didukung dokumen sudah
  terisi atau sudah Anda putuskan."**
- The save failed:
  **"Order gagal disimpan, jadi keputusan terakhir Anda hanya ada di tab
  ini: {sebab}"**
