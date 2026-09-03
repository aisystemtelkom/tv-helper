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

## Glossary

The whole UI must use one word per concept. Pick from this table, do not
improvise a synonym.

| Concept | Bahasa | Notes |
| --- | --- | --- |
| a run (one order being worked) | **pekerjaan** | "Belum ada pekerjaan yang dibuka" |
| a slot (one cell needing evidence) | **bagian** | |
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
| the two deliverables | **berkas hasil** | |

## The four phases

| # | English | Bahasa | Screen heading |
| --- | --- | --- | --- |
| 1 | Ingest | **Muat** | "Muat dokumen order" |
| 2 | Review | **Periksa** | "Periksa usulan" |
| 3 | Outstanding | **Tambahan** | "Yang belum ditemukan" |
| 4 | Export | **Berkas** | "Buat berkas hasil" |

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
| Undo, review again | **Batalkan, periksa lagi** |
| Choose PDFs | **Pilih berkas PDF** |
| Search for these slots | **Cari bagian ini** |
| Cancel | **Batal** |
| Use this zone | **Pakai area ini** |
| Snap to lines | **Kunci ke baris** |
| Build the two files | **Buat kedua berkas** |
| Save `<name>` | **Simpan `<name>`** |
| Back to the review sheet | **Kembali ke lembar periksa** |
| Start a different run | **Mulai pekerjaan lain** |
| Sign in with Google | **Masuk dengan Google** |
| Sign out | **Keluar** |

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
  **"Pekerjaan gagal disimpan, jadi keputusan terakhir Anda hanya ada di tab
  ini: {sebab}"**
