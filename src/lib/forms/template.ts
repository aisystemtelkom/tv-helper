import type { DocType } from "../pipeline/classify.ts";
import type { NodeId } from "./overlay.ts";

/**
 * THE HALF A PROMPT SEES. Frozen at transcription time, never editable by an
 * operator, never on a screen, never on the wire out of a run.
 *
 * Everything in here is measured. `label` and `hint` are what
 * `buildPoolLocatePrompt` and `buildLocatePrompt`
 * (`src/lib/pipeline/locate.ts`) compose the search question out of, what
 * `buildContinuationPrompt` (`src/lib/pipeline/continuation.ts`) asks the
 * lanjutan question with, and what `askedAs` in `scripts/measure-locate.mjs`
 * asks the GATE's question with. AGENTS.md's rule for all three is the same:
 * never re-tune one without re-running `pnpm measure:locate`, and sample it at
 * least three times, because the gate scored 11 / 9 / 11 on three runs of an
 * identical prompt and a single run cannot tell a gain from a regression.
 *
 * ## `label` IS DUPLICATED FROM `SlotDef.label`, AND THE DUPLICATION IS THE
 * ## POINT
 *
 * Both are seeded from the same transcribed string and
 * `scripts/test-pipeline.mjs` pins that they still agree, so today the copy
 * buys nothing. It buys something the moment the display name becomes
 * per-order editable, which is what it is about to become: an operator whose
 * own contract calls the KB row "No. PKS" renames it, the docx prints their
 * word, and the question the gate measured does not move by a byte.
 *
 * Before this split, four prompt builders composed their question out of
 * `label` + `hint` as sibling strings on one type. A rename would therefore
 * have silently rewritten two live prompts and the measurement gate's own
 * question, and the only thing standing in the way was a rule in AGENTS.md
 * that the person doing the renaming cannot read and could not act on if they
 * did: an operator cannot run the gate. Splitting the frozen half out turns
 * that rule into a COMPILER ERROR. A prompt builder handed a `SlotDef` no
 * longer finds a `hint` on it, and one handed a `SlotAsk` cannot see the
 * editable name at all.
 */
export type SlotAsk = {
  /**
   * The slot's name AS THE MODEL IS TOLD IT.
   *
   * Seeded verbatim from `SlotDef.label` and then frozen. `slotSearchLabel`
   * in `scripts/generate.mjs` prefixes it with the section's own frozen
   * `SectionDef.ask.title` before asking, because a row label on its own --
   * "Detail", "Nomor", "ToP" -- is not a question once the pool is the whole
   * bundle rather than one document.
   */
  label: string;
  /**
   * What this slot means, in enough detail to beat a look-alike ELSEWHERE
   * IN THE BUNDLE. Since the search is no longer narrowed by `docType`,
   * every hint competes against every page of every supplied document, so
   * a hint that only names the field ("the date the contract was signed")
   * is now a defect: several documents carry a signing date. Say which
   * document's, and say plainly what it is NOT.
   */
  hint: string;
};

export type SlotDef = {
  key: string;
  /**
   * The name this bagian is SHOWN and PRINTED under: the operator's screens
   * and the docx row.
   *
   * Overlay-editable, per order. Nothing written here can reach a prompt --
   * what the model is asked is `ask.label`, seeded from this string once and
   * frozen beside it -- so this may be renamed to whatever the operator's own
   * paperwork calls the row without re-running the measurement gate. That
   * separation is the whole reason `SlotAsk` exists; read its doc comment
   * before merging the two back together.
   */
  label: string;
  /**
   * The document type this slot's answer is MOST LIKELY to sit in -- a
   * ranking preference handed to the search, never a filter on it.
   *
   * It used to be a filter: `generate.mjs` built each slot's pool out of
   * only the pages `classify.ts` had labelled with this docType. The
   * 2026-08-31 corrections note ("The tool is DOCUMENT-AGNOSTIC. The slot
   * list does not vary.") retires that, because it assumes the sample
   * bundle's structure -- which document carries which field -- and the
   * tool must find the same slots in whatever documents are supplied.
   *
   * Narrowing was not arbitrary, and removing it without replacing it
   * re-opens a real defect: on an unnarrowed pool the customer name matched
   * the printed email thread's own `Cc:` header and both deliverables
   * shipped a WRONG CUSTOMER. The replacement is `ask.hint`, which must
   * describe the thing well enough that the right region wins on merit
   * anywhere in the bundle -- not a smaller haystack. Anything added here
   * should assume the whole bundle is searched.
   */
  docType: DocType | null;
  /**
   * THE QUESTION. Frozen, on no screen, on no wire, not overlay-editable.
   * See `SlotAsk`.
   */
  ask: SlotAsk;
  /**
   * The same field, said to the OPERATOR instead of to the model. Bahasa
   * Indonesia, and NEVER sent anywhere near a prompt: the prompt builders are
   * handed `slot.ask` and nothing else, so no wording here can move a
   * proposal.
   *
   * It exists because `ask.hint` cannot do this job. A hint is a prompt: it is
   * English, it is written to beat a look-alike, and AGENTS.md forbids
   * retuning one without re-running the measurement gate. So the definition
   * the operator is judging against was in the repository and never on the
   * screen, and they were asked to rule on whether a crop matches a
   * specification they could not read. `catatan` is that specification
   * condensed for the person, and it can be reworded freely because no
   * measurement depends on it.
   *
   * `adalah` says what to look for. `bukan` names the look-alike, which is
   * the half the operator actually applies: the failure this product is
   * organised against is a crop of a plausible wrong thing.
   *
   * Optional because a slot that is not `fillable` ships blank and nobody
   * ever rules on it.
   */
  catatan?: { adalah: string; bukan?: string };
  fillable: boolean;
  /**
   * WHICH PAGE OF ITS DOCUMENT TYPE this whole-page slot takes: 0-based,
   * counted among the FILLABLE SIBLINGS OF ITS OWN SECTION THAT SHARE ITS
   * `docType`. `sp.1` is 0 and `sp.2` is 1. Set on every fillable slot of a
   * `layout: "images"` section and absent everywhere else, because only a
   * whole-page capture picks a page by position at all -- a table slot is
   * located by the model and has no ordinal to be wrong about.
   *
   * ## The counter this replaces, and the hazard it closes
   *
   * `wholePageProposals` (`src/app/api/propose/handler.ts`) derives exactly
   * this today with a running counter over the section's fillable slots,
   * advanced for every sibling whether the request wanted it or not --
   * deliberately, so that re-running the search with `sp.1` already confirmed
   * cannot hand `sp.2` the page `sp.1` is already holding.
   *
   * That counter is correct precisely while the TEMPLATE is the only thing
   * that says which slots exist. It stops being correct the day an order can
   * delete one: drop `sp.1` for this order and the counter slides `sp.2` onto
   * the first SP page, and restoring `sp.1` slides it back while `sp.2` still
   * holds a confirmed crop of that same page -- two headings over one
   * picture, arriving silently, which is this project's whole failure class.
   * Declared here, the ordinal survives both.
   *
   * `wholePageProposals` (`src/app/api/propose/handler.ts`) READS THIS AND NO
   * LONGER COUNTS. It is REQUIRED on a fillable slot in a `layout: "images"`
   * section: a missing one throws there naming the key, rather than falling
   * back to a counter. A fallback would be the defect above, restored quietly
   * the first time somebody added a whole-page bagian and forgot the number.
   */
  pageOrdinal?: number;
  /**
   * Present ONLY on a slot that a particular ORDER added. `AO_TEMPLATE` never
   * sets it, and that absence is load-bearing: `added === undefined` means
   * "this bagian is the form", which makes every downstream check a presence
   * test rather than a flag somebody has to remember to set.
   *
   * `origin` records whether a person asked for the bagian or the tool
   * proposed it. That is not decoration either: an "llm" bagian is a
   * suggestion nobody has stood behind yet, and a deliverable looks exactly
   * the same whichever put the row in it.
   */
  added?: { id: NodeId; origin: "human" | "llm" };
  /*
   * THERE IS DELIBERATELY NO CAPTURE COUNT ON A SLOT. If you are about to add
   * one back -- `crops`, `images`, `maxCaptures`, whatever it gets called --
   * this is the field that already existed and was removed, and this is why.
   *
   * It used to say how many images a slot holds, and `kbLanjutan.top`
   * declared 2 because the sample's `KB (lanjutan)` ToP row stacks two
   * pictures in one cell. An operator testing the tool found what that
   * produces: the sheet showed "ToP 1" and "ToP 2" with the second
   * permanently missing, and they said -- correctly -- that there is only
   * ONE ToP. Read off the sample's own pictures, capture 1 is the payment
   * clause's items 1 to 3 and capture 2 is items 4 and 5 OF THAT SAME
   * CLAUSE carrying the next page's header. One clause, split by a page
   * break.
   *
   * So the count was never a property of the FORM. On another contract the
   * same clause fits one page, or runs to three, and any section can run
   * past a page bottom -- the second bundle splits its contract checklist
   * across three tables over 155 pages. Declaring it here asserted a
   * capture existed before anyone had looked, and nothing ever searched for
   * it, so the slot reported "1 of 2" forever by construction.
   *
   * A continuation is now DISCOVERED, per document, by
   * `src/lib/pipeline/continuation.ts`, and appended to `run.slots` by
   * `withDiscoveredCaptures` (`src/lib/browser/captures.ts`). `seedSlots`
   * seeds exactly one capture per fillable slot; everything downstream --
   * `captureLabel`, `planExport`, the sheet -- reads how many captures exist
   * off the RUN. Read those before adding any multiplicity back here.
   *
   * The field outlived its last declaration by one change, kept only so the
   * two readers of `slot.crops ?? 1` compiled while the UI half landed. Both
   * are gone, so it is too.
   */
};

export type SectionDef = {
  /**
   * Stable identity, HAND-WRITTEN beside `title` in the same transcription
   * pass, and NEVER derived from it.
   *
   * A title is a transcription of the sample, and a transcription gets
   * corrected: this file has already had one of these titles argued over. An
   * id derived from the title changes when the title is corrected, and every
   * stored order that patched a judul by id then forks into a patch for a
   * judul that no longer exists and a judul nobody has patched -- a run that
   * loads clean and quietly loses the operator's renames. Writing the id by
   * hand costs one line per section and makes that impossible.
   *
   * Short, stable, kebab or dotted, matching the slot key prefix where the
   * section has one. NEVER contains "#": a capture key is `<slot>#<n>`, so a
   * "#" in an id makes the two unparseable in one direction or the other.
   */
  id: string;
  title: string;
  layout: "images" | "table";
  /**
   * THE SECTION HALF OF THE QUESTION, frozen for the reason `SlotAsk` is.
   *
   * `slotSearchLabel` in `scripts/generate.mjs` composes the search name out
   * of this title (minus its `(lanjutan)` layout suffix) and the slot's own
   * `ask.label`, and `askedAs` in `scripts/measure-locate.mjs` repeats that
   * composition so the gate asks production's question rather than a tidier
   * one. Both were reading `title` directly, which is exactly the wire a
   * per-order rename would have cut.
   */
  ask: { title: string };
  slots: SlotDef[];
  /**
   * Present ONLY on a judul a particular order added; `AO_TEMPLATE` never
   * sets it. `fromSourceId` names the document the judul was read off, so an
   * added judul can be dropped again with the source it came from.
   */
  added?: { id: NodeId; origin: "human" | "llm"; fromSourceId?: string };
};

/**
 * One row of the order's field list: what it is called, and whether a document
 * can back it.
 *
 * IT WAS `XlsxRowDef` AND IT DESCRIBED A SPREADSHEET ROW. This product used to
 * emit an EPIC ORDER_Config workbook alongside the packet, and these rows were
 * that sheet's rows; `nomor`, `itemI`, `itemII` and `keterangan` are still that
 * sheet's columns, transcribed from the sample. The workbook was a misread of
 * what the client asked for and is gone, and the type was renamed with it --
 * a field named for a file this program must never produce is the exact stale
 * name this repo keeps paying for.
 *
 * WHAT SURVIVES IS THE ONE THING THAT WAS NEVER ABOUT THE SHEET: `fieldKey` is
 * the declaration of which values a document can be searched for, and it is
 * still what `extractableFieldKeys` derives the model's question from and what
 * `outstandingFields` reports a blank against. The other four are the
 * operator-facing NAME of the row, and they are why an outstanding entry can
 * say "Contact Last Name" rather than "picContacts".
 */
export type FieldRowDef = {
  nomor?: number;
  itemI?: string;
  itemII?: string;
  keterangan?: "Isi" | "Pilih" | "Klik";
  /** Undefined means no PDF can back this row, so nothing is searched for. */
  fieldKey?: string;
};

export type Template = {
  id: string;
  label: string;
  sections: SectionDef[];
  fieldRows: FieldRowDef[];
  /**
   * What each `fieldRows[].fieldKey` means, keyed by that fieldKey.
   *
   * `SlotAsk.hint` does this job for the crops; this does it for the text
   * values, and for exactly the same reason. `extractFields` is given bare
   * key names ("cc", "alamat"), and a bare key name is the thinnest hint in
   * the pipeline: "cc" alone is what let the model answer with the printed
   * email's own `Cc:` header. That was patched by narrowing `cc`'s pool to
   * the BA Permintaan; the 2026-08-31 corrections note retires pool
   * narrowing, so the description has to carry the disambiguation instead.
   *
   * A key with no entry here is sent to the model as its bare name, which
   * is the behaviour these entries exist to avoid -- add one when you add a
   * backed row.
   */
  fieldHints: Record<string, string>;
  /**
   * fieldKeys whose cell holds a LIST of answers rather than one value.
   *
   * Opt-in, per key, and empty is the safe default: it is the one thing that
   * stops `reconcileFieldValues` from blanking a cell when two documents
   * answer with two DIFFERENT things. See that function for the measurement
   * (`picContacts` shipped blank while the sample's own cell holds both
   * contacts) and for why marking a single-valued key here would silently
   * concatenate two different customers instead of reporting them.
   *
   * Declared on the TEMPLATE rather than as a constant in the pipeline
   * because it is a statement about this form's cells: another order form can
   * hold a list in a different row, and the pipeline must not carry a list of
   * one template's key names.
   */
  fieldLists?: ReadonlySet<string>;
};

/**
 * KB, AND TWO HEADINGS THE OPERATOR FILLS FROM EPIC. That is the whole base
 * form, and the shortness is the point.
 *
 * ## It used to transcribe all twelve of the sample's judul, and that was wrong
 *
 * `fieldRows` is still transcribed from the order sheet that accompanied
 * `Form_Validasi_LOP999001_1-70000000001-contohvpn (2).docx`, and the KB
 * table's two-part split still matches that sample. The SECTION LIST no longer
 * does, deliberately. It used to carry `BA Permintaan`, `SP`, `Email`, `MOM`,
 * `BA Splitting`, `SBR Pricing`, `BASO` and `BA Penjelasan Order` beside these
 * four, which asserted that every order's packet contains all of them.
 *
 * AGENTS.md already held the measurement that says otherwise: the two sample
 * bundles share TWO headings out of about a dozen. A judul the base form
 * declares is one every order is TOLD IT OWES EVIDENCE FOR -- it seeds a
 * capture, it is searched, and when the order has no such document it reports
 * `tidak ditemukan`, which means "we looked and found nothing" and sends the
 * operator to fetch a berkas that was never going to exist. The operator's own
 * words, 2026-09-11: *"Anything outside of KB shouldn't be rigid required
 * field."*
 *
 * What the surplus declarations also bought was a DUPLICATE HEADING the tool
 * could not see. `BA Permintaan` took page 1 of a berkas as a whole-page
 * capture; judul discovery read the same page and proposed `BERITA ACARA
 * PERMINTAAN ORDER` out of it; the operator was shown one document under two
 * headings. `recordProposals` screens a usulan against `overlay.added` only, so
 * a base judul cannot suppress one -- and no screening rule was added here,
 * because with those judul gone there is nothing left to collide with. Every
 * surviving judul is either KB (crops inside a page, never a whole-page claim)
 * or title-only.
 *
 * NONE OF THE EIGHT IS LOST. `src/lib/pipeline/sections.ts` proposes headings
 * per berkas off the scans, and `add-section` adds one by hand; both put a
 * person in front of the heading before it can reach the packet, which is more
 * review than a compile-time constant ever gave them.
 *
 * ## What is left, and why these four
 *
 * `kb` and `kb-lanjutan` are the only judul with `fillable` bagian, so they are
 * the only thing searched. All seven carry `docType: "KB"` and `layout:
 * "table"`: a specific field at a location within a page, which is what
 * `locateSlot` finds. They are also the only rows the measurement gate scores
 * by `slotKey`, so the base form and the thing the gate measures are now the
 * same short list.
 *
 * `konfigurasi-epic` and `konfigurasi` declare no fillable bagian at all. They
 * print as a heading over their own labelled but EMPTY rows, and the operator
 * fills them from EPIC after the packet is written -- a deliberately empty cell
 * is the deliverable. They are kept where `MOM`, `BASO` and the rest were not
 * because the operator asked for exactly these two to keep shipping.
 *
 * `layout: "images"` is no longer reached by anything here. It is what
 * `resolveAdded` gives every bagian under an ADDED judul, whose pages a person
 * picked, so the whole-page path in `src/app/api/propose/handler.ts` stays live
 * and stays covered -- it is simply no longer something the base form asks for.
 *
 * `ask.title` and every `ask.label` below are seeded VERBATIM from the
 * `title` and `label` beside them, which is what makes the split that
 * introduced them behaviour-identical by construction. A test in
 * `scripts/test-pipeline.mjs` pins that they still agree, so an edit that
 * lets one drift from the other has to be a deliberate one.
 */
export const AO_TEMPLATE: Template = {
  id: "AO",
  label: "DOKUMEN VALIDASI",
  sections: [
    {
      id: "kb",
      title: "KB",
      layout: "table",
      ask: { title: "KB" },
      slots: [
        {
          key: "kb.nomor",
          label: "Nomor",
          docType: "KB",
          ask: {
            label: "Nomor",
            hint:
              "the contract number of the Perjanjian Kerjasama itself, in the " +
              "agreement's opening title block, above the parties. Not a " +
              "reference number on a covering letter, an appointment letter " +
              "(Surat Penunjukan), a memo, an order form or an email.",
          },
          catatan: {
            adalah:
              "Nomor Perjanjian Kerjasama itu sendiri, di blok judul pembuka " +
              "perjanjian, di atas para pihak.",
            bukan:
              "Bukan nomor surat pengantar, Surat Penunjukan, memo, formulir " +
              "order, atau email.",
          },
          fillable: true,
        },
        {
          key: "kb.paraPihak",
          label: "Para Pihak",
          docType: "KB",
          ask: {
            label: "Para Pihak",
            hint:
              "the two parties entering the Perjanjian Kerjasama, in the block " +
              "that introduces them (PIHAK PERTAMA and PIHAK KEDUA) with their " +
              "names, addresses and representatives. Not an email header, a " +
              "distribution list, a recipient block on a letter, or a " +
              "signature block.",
          },
          catatan: {
            adalah:
              "Blok yang memperkenalkan kedua pihak Perjanjian Kerjasama, " +
              "PIHAK PERTAMA dan PIHAK KEDUA, lengkap dengan nama, alamat, " +
              "dan wakilnya.",
            bukan:
              "Bukan kepala email, daftar distribusi, blok penerima surat, " +
              "atau blok tanda tangan.",
          },
          fillable: true,
        },
        {
          key: "kb.tanggal",
          label: "Tanggal",
          docType: "KB",
          ask: {
            label: "Tanggal",
            hint:
              "the date the Perjanjian Kerjasama was signed, as its own " +
              "opening states it (the hari/tanggal sentence). Not a letter " +
              "date, an email date, a print or scan date, or a date inside a " +
              "payment or delivery clause.",
          },
          catatan: {
            adalah:
              "Tanggal Perjanjian Kerjasama ditandatangani, pada kalimat hari " +
              "dan tanggal di pembukaannya.",
            bukan:
              "Bukan tanggal surat, tanggal email, tanggal cetak atau pindai, " +
              "dan bukan tanggal di dalam pasal pembayaran atau pengiriman.",
          },
          fillable: true,
        },
        {
          key: "kb.jangkaWaktu",
          label: "Jangka Waktu",
          docType: "KB",
          ask: {
            label: "Jangka Waktu",
            hint:
              "the duration or term of the Perjanjian Kerjasama (Jangka Waktu " +
              "Perjanjian): when it takes effect and how long it runs. Not a " +
              "payment period, a delivery deadline, or a service period on an " +
              "order form. Start at the clause's own number line (the 'Pasal N' " +
              "line), not at the title beneath it.",
          },
          catatan: {
            adalah:
              "Pasal Jangka Waktu Perjanjian: kapan perjanjian mulai berlaku " +
              "dan berapa lama berjalan, dimulai dari baris nomor pasalnya, " +
              "bukan dari judul di bawahnya.",
            bukan:
              "Bukan jangka waktu pembayaran, batas waktu pengiriman, atau " +
              "masa layanan pada formulir order.",
          },
          fillable: true,
        },
      ],
    },
    {
      id: "kb-lanjutan",
      title: "KB (lanjutan)",
      layout: "table",
      // The `(lanjutan)` suffix is kept here VERBATIM even though
      // `slotSearchLabel` strips it before asking, because this is the frozen
      // copy of what the sample's own heading says. Stripping it at the
      // transcription would hide a measured decision inside a constant; it is
      // made, and commented, where the question is composed.
      ask: { title: "KB (lanjutan)" },
      slots: [
        {
          key: "kbLanjutan.detail",
          label: "Detail",
          docType: "KB",
          ask: {
            label: "Detail",
            hint:
              "the scope of work and its pricing in the Perjanjian Kerjasama " +
              "(Ruang Lingkup dan Harga Pekerjaan), usually a table of items " +
              "and amounts. Not a quotation, a price list, or a configuration " +
              "table on an order form. Start at the clause's own number line " +
              "(the 'Pasal N' line), not at the title beneath it.",
          },
          catatan: {
            adalah:
              "Pasal Ruang Lingkup dan Harga Pekerjaan pada Perjanjian " +
              "Kerjasama, biasanya berupa tabel rincian pekerjaan dan " +
              "nilainya, dimulai dari baris nomor pasalnya.",
            bukan:
              "Bukan penawaran harga, daftar harga, atau tabel konfigurasi " +
              "pada formulir order.",
          },
          fillable: true,
        },
        {
          key: "kbLanjutan.top",
          label: "ToP",
          docType: "KB",
          ask: {
            label: "ToP",
            hint:
              "the clause of the Perjanjian Kerjasama that sets the terms of " +
              "payment for the work (Pembayaran Pekerjaan): when the invoice " +
              "is raised and by when it is paid. Not a price table, and not a " +
              "billing period on an order form. Start at the clause's own " +
              "number line (the 'Pasal N' line), not at the title beneath it.",
          },
          catatan: {
            adalah:
              "Pasal Pembayaran Pekerjaan pada Perjanjian Kerjasama, dimulai " +
              "dari baris nomor pasalnya, yang menyebut kapan tagihan " +
              "diterbitkan dan kapan harus dibayar; potongan keduanya adalah " +
              "blok rekening tujuan pembayaran.",
            bukan:
              "Bukan tabel harga, dan bukan periode penagihan pada formulir " +
              "order.",
          },
          fillable: true,
          // THE `crops: 2` THAT USED TO SIT HERE IS GONE. See the `crops`
          // doc comment on SlotDef for the operator report that removed it:
          // the sample's two pictures in this cell are one payment clause
          // split by a page break, not two things this form asks for, and
          // declaring the second asserted it existed before anyone looked
          // while nothing ever searched for it.
          //
          // The hint above still describes the FIRST capture only, and that
          // is still deliberate and still measured: naming the remittance
          // account block that the sample's second picture holds made the
          // single locate call land on the account page and miss the clause,
          // i.e. it answered the continuation and dropped the block. One
          // call, one thing. What finds the rest of the clause now is
          // `src/lib/pipeline/continuation.ts`, working forward from this
          // capture, which needs no hint of its own because it is given the
          // page and the block's own tail.
        },
        {
          key: "kbLanjutan.ttdPejabat",
          label: "TTD Pejabat",
          docType: "KB",
          ask: {
            label: "TTD Pejabat",
            hint:
              "the signature block that closes the Perjanjian Kerjasama, " +
              "where the officials of both parties sign, with their names and " +
              "titles. Not the signature on an appointment letter (Surat " +
              "Penunjukan), on a Berita Acara, or in an email footer.",
          },
          catatan: {
            adalah:
              "Blok tanda tangan penutup Perjanjian Kerjasama, tempat pejabat " +
              "kedua pihak menandatangani lengkap dengan nama dan jabatannya.",
            bukan:
              "Bukan tanda tangan pada Surat Penunjukan, pada Berita Acara, " +
              "atau di kaki email.",
          },
          fillable: true,
        },
      ],
    },
    {
      id: "konfigurasi-epic",
      title: "Konfigurasi (Excel dari EPIC)",
      layout: "table",
      ask: { title: "Konfigurasi (Excel dari EPIC)" },
      slots: [
        {
          key: "konfigurasiEpic.sid",
          label: "SID",
          docType: null,
          ask: {
            label: "SID",
            hint: "the EPIC service id, not backed by a PDF in v1",
          },
          fillable: false,
        },
        {
          key: "konfigurasiEpic.konfigurasi",
          label: "Konfigurasi",
          docType: null,
          ask: {
            label: "Konfigurasi",
            hint: "the EPIC configuration excerpt, not backed by a PDF in v1",
          },
          fillable: false,
        },
      ],
    },
    {
      id: "konfigurasi",
      title: "Konfigurasi",
      layout: "table",
      ask: { title: "Konfigurasi" },
      slots: [
        {
          // The sample labels this row with the quote number itself, e.g.
          // "1-70000000001". The exporter substitutes the real quote for
          // this literal token.
          key: "konfigurasi.quote",
          label: "{{quote}}",
          docType: null,
          // Seeded verbatim like every other `ask.label`, template token and
          // all. It is never asked -- the slot is not `fillable` -- and
          // "correcting" it here would be a silent divergence from the rule
          // the test pins.
          ask: {
            label: "{{quote}}",
            hint: "the quote number, not backed by a PDF in v1",
          },
          fillable: false,
        },
        {
          key: "konfigurasi.priceSa",
          label: "Price & SA",
          docType: null,
          ask: {
            label: "Price & SA",
            hint: "price and service address from EPIC, not backed by a PDF in v1",
          },
          fillable: false,
        },
        {
          key: "konfigurasi.bw",
          label: "BW",
          docType: null,
          ask: {
            label: "BW",
            hint: "bandwidth from EPIC, not backed by a PDF in v1",
          },
          fillable: false,
        },
        {
          key: "konfigurasi.ba",
          label: "BA",
          docType: null,
          ask: {
            label: "BA",
            hint: "the BA reference from EPIC, not backed by a PDF in v1",
          },
          fillable: false,
        },
      ],
    },
  ],
  // The 34 rows of the order's field list, transcribed from the sample's own
  // order sheet in its order. Only rows a PDF can back carry a fieldKey; every
  // other row -- including the four EPIC-only rows below and duplicate
  // occurrences of an already-backed value -- stays undefined, so nothing is
  // ever searched for on their account.
  //
  // THE UNBACKED ROWS ARE KEPT DELIBERATELY, now that no file is generated
  // from this list. They are what lets `outstandingFields` and the operator's
  // own screens name a row the way the order names it, and dropping them would
  // turn this into a bare list of four keys that no longer says what the order
  // is made of.
  fieldRows: [
    // generate.mjs's NEVER_EXTRACTED keeps this fieldKey from ever being
    // sent to the model: on the full order-paperwork pool it reliably named
    // the master contract's scope title, not this order's project name, and
    // that wrong value carried a citation that passed validation (task-11
    // finding 3). The row stays blank by construction until composing it
    // reliably from BA Permintaan's `Tipe Permintaan` and `Nama Lokasi` is
    // implemented.
    { nomor: 1, itemI: "Lead", itemII: "Description", keterangan: "Isi",
      fieldKey: "namaProyek" },
    { itemII: "Contact Last Name", keterangan: "Pilih", fieldKey: "picContacts" },
    { itemII: "Account", keterangan: "Isi", fieldKey: "cc" },
    { nomor: 2, itemI: "Opportunity", itemII: "Contact", keterangan: "Isi" },
    {},
    // Sheet row 7: the service address's first (and only fieldKey-bearing)
    // occurrence. Sheet row 12 ("Service Account") repeats the same value
    // and must NOT carry this fieldKey -- see the row below.
    { nomor: 3, itemI: "Quote", itemII: "Field Name", keterangan: "Isi",
      fieldKey: "alamat" },
    { itemII: "Sales Team", keterangan: "Pilih" },
    { itemII: "Comment", keterangan: "Isi" },
    { itemII: "Customer Account", keterangan: "Pilih" },
    { itemII: "Last Name", keterangan: "Pilih" },
    // Sheet row 12: the service address's second occurrence. No fieldKey.
    { itemII: "Service Account", keterangan: "Pilih" },
    { itemII: "Billing Account", keterangan: "Pilih" },
    { itemII: "Term Of Payment", keterangan: "Pilih" },
    { itemII: "Price List", keterangan: "Pilih" },
    { itemII: "Catalog", keterangan: "Pilih" },
    { itemII: "Catalog II", keterangan: "Pilih" },
    { nomor: 4, itemI: "Customize MPLS VPN IP Node", keterangan: "Klik" },
    { nomor: 5, itemI: "Attribute", itemII: "MPLS VPN IP Service Type",
      keterangan: "Pilih" },
    { itemII: "MPLS VPN IP Node Topology", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP Access Technology", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP VRF", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP VRF Name", keterangan: "Isi" },
    { itemII: "MPLS VPN IP Routing Type", keterangan: "Isi" },
    { itemII: "MPLS VPN IP Address", keterangan: "Isi" },
    { itemII: "MPLS VPN IP Subnet Mask", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP Region", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP HRB/STO", keterangan: "Pilih" },
    { itemII: "MPLS VPN IP SLG", keterangan: "Isi" },
    { nomor: 6, itemI: "Package", itemII: "Item", keterangan: "Pilih" },
    { itemII: "Customize (Gear)", keterangan: "Klik" },
    { itemII: "MPLS VPN IP Bandwidth", keterangan: "Isi" },
    { nomor: 7, itemI: "Charges",
      itemII: "Customize (Gear) MPLS VPN IP Biaya Aktivasi - Domestik",
      keterangan: "Klik" },
    { itemII: "MPLS VPN IP City", keterangan: "Pilih" },
    { itemII: "LatLong", keterangan: "Pilih" },
  ],

  // Every backed fieldKey above, described well enough to survive a search
  // over the WHOLE bundle. See the `fieldHints` doc comment on `Template`
  // for why these are not optional colour: `cc`'s pool used to be narrowed
  // to the BA Permintaan precisely because the bare key name lost to the
  // email thread's own `Cc:` header, and pool narrowing is gone.
  //
  // Deliberately free of any real customer name, address or contact: this
  // file is committed to a public repo, and an example lifted from the
  // sample bundle would both leak a client identifier and prime the model
  // to answer with it.
  fieldHints: {
    namaProyek:
      "The name of THIS order's work: the service being requested together " +
      "with the specific site it is for, as the order request itself states " +
      "it -- typically the request type plus the location or branch name. " +
      "It is NOT the framework agreement's title, NOT the subject line or " +
      "'perihal' of an appointment letter (Surat Penunjukan), and NOT the " +
      "contract's Ruang Lingkup wording: those describe the whole " +
      "multi-year contract, not this single order.",
    picContacts:
      "The person or people named as the contact (PIC) for this order, each " +
      "with the phone number given for them, as the order request or the " +
      "email thread that raised it lists them. People, not organisations; " +
      "keep every contact listed, one per line.",
    cc:
      "The CUSTOMER organisation this order is for -- the subscriber named " +
      "on the order request as the party being served, spelled as that " +
      "request spells it. It is a company or institution, never a person. " +
      "Do NOT take it from an email header line (From, To, Cc, Sent, " +
      "Subject), from a distribution list, or from a mail signature, and do " +
      "NOT answer with Telkom or any Telkom unit: Telkom is the provider " +
      "raising the paperwork, not the customer.",
    alamat:
      "The service address of the site this order installs at: the street " +
      "address of the customer location named on the order request, with " +
      "its RT/RW, kelurahan, kecamatan, city and province as printed. NOT " +
      "the customer's head-office address from the agreement's party block, " +
      "NOT Telkom's address, and NOT a postal address in an email footer.",
  },

  // `picContacts` is a LIST, and saying so here is what stops it shipping
  // blank. Measured 2026-09-03 on the sample bundle: the model answers with
  // two contact people, `sameEntity` correctly reports that two people are not
  // one person, and `reconcileFieldValues` blanked the cell as a conflict --
  // while the human-authored sample's own "Contact Last Name" cell holds both
  // of them joined by a newline, which is also what the hint above asks for.
  // Only this key is listed: every other backed key holds one value, and
  // adding one that does would turn a reported disagreement into a silently
  // concatenated cell.
  fieldLists: new Set(["picContacts"]),
};
