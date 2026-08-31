import type { DocType } from "../pipeline/classify.ts";

export type SlotDef = {
  key: string;
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
   * shipped a WRONG CUSTOMER. The replacement is the `hint` below, which
   * must describe the thing well enough that the right region wins on merit
   * anywhere in the bundle -- not a smaller haystack. Anything added here
   * should assume the whole bundle is searched.
   */
  docType: DocType | null;
  /**
   * What this slot means, in enough detail to beat a look-alike ELSEWHERE
   * IN THE BUNDLE. Since the search is no longer narrowed by `docType`,
   * every hint competes against every page of every supplied document, so
   * a hint that only names the field ("the date the contract was signed")
   * is now a defect: several documents carry a signing date. Say which
   * document's, and say plainly what it is NOT.
   */
  hint: string;
  fillable: boolean;
  /**
   * How many images this slot holds. Defaults to 1 when absent, so every
   * existing slot keeps its current meaning without being touched.
   *
   * This exists because a `layout: "table"` row in the source docx can
   * stack more than one picture in a single cell -- unlike `layout:
   * "images"`, where each picture is already its own paragraph and thus
   * its own slot (e.g. `sp.1` / `sp.2`). The sample's `KB (lanjutan)`
   * table's `ToP` row stacks two images (rId17 -> image9.png, rId18 ->
   * image10.png) in one cell; that is one row with one label, so it stays
   * one `SlotDef`, not two. Without an explicit count here, an exporter
   * that takes one PNG per slot key would silently drop the second
   * capture -- do not remove this field to "simplify" the type.
   */
  crops?: number;
};

export type SectionDef = {
  title: string;
  layout: "images" | "table";
  slots: SlotDef[];
};

export type XlsxRowDef = {
  nomor?: number;
  itemI?: string;
  itemII?: string;
  keterangan?: "Isi" | "Pilih" | "Klik";
  /** Undefined means no PDF can back this row, so it stays blank. */
  fieldKey?: string;
};

export type Template = {
  id: string;
  label: string;
  sections: SectionDef[];
  xlsxRows: XlsxRowDef[];
  /**
   * What each `xlsxRows[].fieldKey` means, keyed by that fieldKey.
   *
   * `SlotDef.hint` does this job for the crops; this does it for the text
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
};

/**
 * Transcribed from `Form_Validasi_LOP999001_1-70000000001-contohvpn (2).docx`
 * (word/document.xml) and `LOP999001_ORDER_Config_VPN_PSB_KCP_Contoh.xlsx`.
 * This is a transcription, not a redesign: section names, row labels, order,
 * the empty sections, and the KB table's two-part split all match the
 * sample as it stands.
 *
 * Every section here is one of two kinds (the Task 7 finding this encodes):
 *   - "images": a human filling the sample screenshots the whole page.
 *     There is no region inside the page to locate -- the whole rendered
 *     page (or one of several, for SP) is the capture.
 *   - "table": a specific field lives at a location within a page, so a
 *     slot here is something `locateSlot` finds.
 */
export const AO_TEMPLATE: Template = {
  id: "AO",
  label: "DOKUMEN VALIDASI",
  sections: [
    {
      title: "BA Permintaan",
      layout: "images",
      slots: [
        {
          key: "ba.permintaan",
          label: "BA Permintaan",
          docType: "BAPermintaan",
          hint: "the whole Berita Acara Permintaan Order page",
          fillable: true,
        },
      ],
    },
    {
      title: "SP",
      layout: "images",
      slots: [
        {
          key: "sp.1",
          label: "SP",
          docType: "SP",
          hint: "the whole Surat Penunjukan page",
          fillable: true,
        },
        {
          key: "sp.2",
          label: "SP (lanjutan)",
          docType: "SP",
          hint: "the second whole page of the Surat Penunjukan",
          fillable: true,
        },
      ],
    },
    {
      title: "KB",
      layout: "table",
      slots: [
        {
          key: "kb.nomor",
          label: "Nomor",
          docType: "KB",
          hint:
            "the contract number of the Perjanjian Kerjasama itself, in the " +
            "agreement's opening title block, above the parties. Not a " +
            "reference number on a covering letter, an appointment letter " +
            "(Surat Penunjukan), a memo, an order form or an email.",
          fillable: true,
        },
        {
          key: "kb.paraPihak",
          label: "Para Pihak",
          docType: "KB",
          hint:
            "the two parties entering the Perjanjian Kerjasama, in the block " +
            "that introduces them (PIHAK PERTAMA and PIHAK KEDUA) with their " +
            "names, addresses and representatives. Not an email header, a " +
            "distribution list, a recipient block on a letter, or a " +
            "signature block.",
          fillable: true,
        },
        {
          key: "kb.tanggal",
          label: "Tanggal",
          docType: "KB",
          hint:
            "the date the Perjanjian Kerjasama was signed, as its own " +
            "opening states it (the hari/tanggal sentence). Not a letter " +
            "date, an email date, a print or scan date, or a date inside a " +
            "payment or delivery clause.",
          fillable: true,
        },
        {
          key: "kb.jangkaWaktu",
          label: "Jangka Waktu",
          docType: "KB",
          hint:
            "the duration or term of the Perjanjian Kerjasama (Jangka Waktu " +
            "Perjanjian): when it takes effect and how long it runs. Not a " +
            "payment period, a delivery deadline, or a service period on an " +
            "order form. Start at the clause's own number line (the 'Pasal N' " +
            "line), not at the title beneath it.",
          fillable: true,
        },
      ],
    },
    {
      title: "KB (lanjutan)",
      layout: "table",
      slots: [
        {
          key: "kbLanjutan.detail",
          label: "Detail",
          docType: "KB",
          hint:
            "the scope of work and its pricing in the Perjanjian Kerjasama " +
            "(Ruang Lingkup dan Harga Pekerjaan), usually a table of items " +
            "and amounts. Not a quotation, a price list, or a configuration " +
            "table on an order form. Start at the clause's own number line " +
            "(the 'Pasal N' line), not at the title beneath it.",
          fillable: true,
        },
        {
          key: "kbLanjutan.top",
          label: "ToP",
          docType: "KB",
          hint:
            "the clause of the Perjanjian Kerjasama that sets the terms of " +
            "payment for the work (Pembayaran Pekerjaan): when the invoice " +
            "is raised and by when it is paid. Not a price table, and not a " +
            "billing period on an order form. Start at the clause's own " +
            "number line (the 'Pasal N' line), not at the title beneath it.",
          fillable: true,
          // The sample stacks two images in this one cell (rId17/image9.png
          // and rId18/image10.png). See the `crops` doc comment on SlotDef.
          //
          // The hint above describes the FIRST of those two -- the payment
          // clause itself. It deliberately does not mention the remittance
          // account block that the second capture holds: naming both in one
          // hint made the single call this pass makes land on the account
          // page and miss the clause, i.e. it answered the second capture
          // and dropped the first. One call, one thing. The second capture
          // is what the dokumen tambahan round and manual selection are for,
          // and `outstandingSlots` reports it as "1 of 2 captures found".
          crops: 2,
        },
        {
          key: "kbLanjutan.ttdPejabat",
          label: "TTD Pejabat",
          docType: "KB",
          hint:
            "the signature block that closes the Perjanjian Kerjasama, " +
            "where the officials of both parties sign, with their names and " +
            "titles. Not the signature on an appointment letter (Surat " +
            "Penunjukan), on a Berita Acara, or in an email footer.",
          fillable: true,
        },
      ],
    },
    {
      title: "Konfigurasi (Excel dari EPIC)",
      layout: "table",
      slots: [
        {
          key: "konfigurasiEpic.sid",
          label: "SID",
          docType: null,
          hint: "the EPIC service id, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "konfigurasiEpic.konfigurasi",
          label: "Konfigurasi",
          docType: null,
          hint: "the EPIC configuration excerpt, not backed by a PDF in v1",
          fillable: false,
        },
      ],
    },
    {
      title: "Konfigurasi",
      layout: "table",
      slots: [
        {
          // The sample labels this row with the quote number itself, e.g.
          // "1-70000000001". The exporter substitutes the real quote for
          // this literal token.
          key: "konfigurasi.quote",
          label: "{{quote}}",
          docType: null,
          hint: "the quote number, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "konfigurasi.priceSa",
          label: "Price & SA",
          docType: null,
          hint: "price and service address from EPIC, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "konfigurasi.bw",
          label: "BW",
          docType: null,
          hint: "bandwidth from EPIC, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "konfigurasi.ba",
          label: "BA",
          docType: null,
          hint: "the BA reference from EPIC, not backed by a PDF in v1",
          fillable: false,
        },
      ],
    },
    {
      title: "Email",
      layout: "images",
      slots: [
        {
          key: "email.1",
          label: "Email",
          docType: "Email",
          hint: "the whole printed email thread page",
          fillable: true,
        },
      ],
    },
    {
      title: "MOM",
      layout: "images",
      slots: [],
    },
    {
      title: "BA Splitting",
      layout: "table",
      slots: [
        {
          key: "baSplitting.nomor",
          label: "Nomor",
          docType: null,
          hint: "the BA Splitting number, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "baSplitting.detailKontrak",
          label: "Detail Kontrak",
          docType: null,
          hint: "the contract detail, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "baSplitting.detailSplitting",
          label: "Detail Splitting",
          docType: null,
          hint: "the splitting detail, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "baSplitting.ttdPejabat",
          label: "TTD Pejabat",
          docType: null,
          hint: "the signing official's signature block, not backed by a PDF in v1",
          fillable: false,
        },
      ],
    },
    {
      title: "SBR Pricing",
      layout: "table",
      slots: [
        {
          key: "sbrPricing.nomorTanggal",
          // The sample keeps this parenthetical -- there is no SBR pricing
          // document number in this bundle -- and this row transcribes it
          // deliberately intact.
          label: "Nomor dan tanggal (tidak ada)",
          docType: null,
          hint: "the SBR pricing document's number and date, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "sbrPricing.diskonCc",
          label: "Diskon ke CC",
          docType: null,
          hint: "the discount extended to the customer, not backed by a PDF in v1",
          fillable: false,
        },
        {
          key: "sbrPricing.ttdPejabat",
          label: "TTD Pejabat",
          docType: null,
          hint: "the signing official's signature block, not backed by a PDF in v1",
          fillable: false,
        },
      ],
    },
    {
      title: "BASO",
      layout: "images",
      slots: [],
    },
    {
      title: "BA Penjelasan Order",
      layout: "images",
      slots: [],
    },
  ],
  // Transcribes the sample workbook's 34 data rows (sheet rows 2-35). The
  // header row is emitted by the exporter, not stored here. Only rows a PDF
  // can back carry a fieldKey; every other row -- including the four
  // EPIC-only rows below and duplicate occurrences of an already-backed
  // value -- stays undefined so it is blank by construction.
  xlsxRows: [
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
};
