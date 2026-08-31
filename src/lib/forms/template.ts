import type { DocType } from "../pipeline/classify.ts";

export type SlotDef = {
  key: string;
  label: string;
  docType: DocType | null;
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
};

/**
 * Transcribed from `Form_Validasi_LOP285120_1-72989090591-bsivpn (2).docx`
 * (word/document.xml) and `LOP285120_ORDER_Config_VPN_PSB_KCP_Slipi.xlsx`.
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
          hint: "the contract number of the Perjanjian Kerjasama",
          fillable: true,
        },
        {
          key: "kb.paraPihak",
          label: "Para Pihak",
          docType: "KB",
          hint: "the parties named in the Perjanjian Kerjasama",
          fillable: true,
        },
        {
          key: "kb.tanggal",
          label: "Tanggal",
          docType: "KB",
          hint: "the date the contract was signed",
          fillable: true,
        },
        {
          key: "kb.jangkaWaktu",
          label: "Jangka Waktu",
          docType: "KB",
          hint: "the contract's term or duration",
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
          hint: "the contract's detail clause",
          fillable: true,
        },
        {
          key: "kbLanjutan.top",
          label: "ToP",
          docType: "KB",
          hint: "the contract's terms of payment",
          fillable: true,
          // The sample stacks two images in this one cell (rId17/image9.png
          // and rId18/image10.png). See the `crops` doc comment on SlotDef.
          crops: 2,
        },
        {
          key: "kbLanjutan.ttdPejabat",
          label: "TTD Pejabat",
          docType: "KB",
          hint: "the signing official's signature block",
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
          // "1-72989090591". The exporter substitutes the real quote for
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
};
