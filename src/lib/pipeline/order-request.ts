/**
 * The ORDER REQUEST reader: the one input in this pipeline that is already
 * structured, and the one that answers most of the workbook.
 *
 * WHY THIS MODULE EXISTS, with the numbers that bought it. The 2026-09-03
 * second-bundle findings classified every filled value cell in both bundles'
 * EPIC config sheets by where the value actually came from:
 *
 *   | Origin                          | bundle one | bundle two |
 *   | the ORDER REQUEST               |     13     |     12     |
 *   | a constant/dropdown per service |     13     |     12     |
 *   | an EPIC-internal id             |      3     |      4     |
 *   | THE SCANNED CONTRACT PDFs       |      1     |      0     |
 *   | unknown                         |      1     |      3     |
 *
 * Zero to one cell of thirty-one needs the scans. Everything else the pipeline
 * has been asking a vision model to find in a 29-page (bundle two: 155-page)
 * contract was sitting in a spreadsheet nobody had told it about. This reader
 * is the correction, and it is worth having precisely because it is
 * DETERMINISTIC: no OCR, no model call, no network, no credential. A value it
 * supplies is read out of a cell, not inferred from a picture of one, and its
 * provenance is a file name and a row number rather than a citation that has
 * to be validated before it can be trusted.
 *
 * THE ORDER REQUEST IS A ROLE, NOT A FILE FORMAT. Bundle two ships it as an
 * xlsx laid out as row 1 = type hints, row 2 = headers, one row per SID.
 * Bundle one has no such file at all: its request arrived as an email, which
 * is already a page of the scanned bundle and which `classify.ts` already
 * labels `Email` without ever mining it for values. This module reads the xlsx
 * shape only. Mining the email is a separate job with a separate failure mode
 * (it needs the model, and `cc` has already shipped a wrong customer name off
 * an email header once), so it is deliberately not folded in here.
 *
 * WHAT IT REFUSES TO DO, and why each refusal is the point:
 *
 * - IT NEVER TRANSLATES A VALUE. The request prints `Recc` where the config
 *   sheet reads `Monthly postpaid`, and `172 Mbps` where the config reads
 *   `172`. Those mappings are real and they are the operator's, not this
 *   file's: a translation table maintained here would be a second, silent
 *   source of truth that looks right until the day a service type spells one
 *   of them differently. Text travels verbatim.
 * - IT NEVER GUESSES A COLUMN. Headers are matched against a closed table
 *   after normalisation, and anything that does not match is reported in
 *   `unmapped` rather than fuzzily mapped or silently dropped. A column this
 *   reader has never seen is a thing for a human to look at, not a thing to
 *   pattern-match.
 * - IT NEVER PICKS A SERVICE FOR YOU. See `orderRequestFieldValues`.
 *
 * Everything below `readOrderRequestBuffer` is pure and takes a plain grid of
 * strings, so the whole mapping is testable without exceljs, without a file,
 * and without any of the real client material in `documents/`.
 */

import exceljs from "exceljs";
import type { FieldValue } from "./fields.ts";

// `RequestSource` -- the provenance an xlsx cell note prints for a value read
// out of the request -- is declared ONCE, in `./fields.ts`, beside the
// `FieldValue` that carries it. There used to be a second copy here, imported
// by nothing: `orderRequestFieldValues` builds an object literal that is
// checked against the fields.ts version only, so the two could drift with no
// type error while both carried authoritative-sounding prose. That is the
// duplicated-definition hazard the 2026-09-03 findings' module move was
// undertaken to avoid.

/** One mapped cell of one service row. */
export type OrderRequestCell = {
  fieldKey: string;
  header: string;
  column: string;
  /** Row 1's type hint for this column, verbatim: "(text)", "(date)--tidak
   *  mandatory". Carried but never acted on -- it is documentation the client
   *  wrote for a human, and treating "(number)" as an instruction to coerce is
   *  how `172 Mbps` becomes `172` without anyone deciding that it should. */
  hint: string;
  /** The cell's text, verbatim. */
  text: string;
};

/** One service: one SID, one row. */
export type OrderRequestService = {
  /** 1-based worksheet row. */
  row: number;
  /** The SID column's text, or "" when the request prints no SID. */
  sid: string;
  cells: OrderRequestCell[];
};

/** A column that produced no field, and why. Always reported; never dropped. */
export type UnmappedColumn = {
  column: string;
  header: string;
  reason: string;
};

export type OrderRequest = {
  file: string;
  sheet: string;
  services: OrderRequestService[];
  /**
   * The requested order type, when every service agrees on one -- and "" when
   * they do not, or when the request has no such column.
   *
   * A STRING, ALWAYS, and never an object. `resolveJenisOrder` in
   * scripts/generate.mjs reads this as `String(orderRequest?.jenisOrder ?? "")`
   * and would print `[object Object]` into the header cell a validator signs
   * if this ever became structured. The structure lives in
   * `jenisOrderReadings` instead.
   */
  jenisOrder: string;
  /** Every distinct non-empty reading of the jenis-order column, in row order.
   *  More than one means the services disagree and `jenisOrder` is blank. */
  jenisOrderReadings: string[];
  unmapped: UnmappedColumn[];
};

/**
 * Header text -> the fieldKey the rest of the pipeline uses, matched on the
 * NORMALISED header (see `normalizeHeader`). A closed table on purpose:
 * `parseOrderRequestGrid` reports anything absent from it instead of guessing.
 *
 * THREE ENTRIES ARE DELIBERATELY NOT THE OBVIOUS ONES, and each one is a
 * wrong-and-quiet failure avoided rather than a naming preference:
 *
 * - `Last Order` -> `lastOrder`, NOT `quote`. The column holds a quote-shaped
 *   number (`1-70000000001`) that matches `deriveIdsFromFilenames`' own
 *   `\d-\d{9,}` shape exactly, and it is the PREVIOUS order's number: mapping
 *   it to `quote` would overwrite this order's quote with the one being
 *   superseded, in a cell that looks perfectly well-formed.
 * - `Akun Baru` -> `akunBaru`, NOT `cc`. `cc` is one of the two poisoned
 *   fields (2026-09-03 findings, section 4): a wrong customer name has already
 *   shipped in both deliverables once, off an email's own `Cc:` header. The
 *   one request we have leaves this column EMPTY in every row, so there is no
 *   evidence at all about what it holds -- and "probably the account name" is
 *   not a basis for filling that particular cell.
 * - `SID` -> `sid`, which `orderRequestFieldValues` then excludes from the
 *   values it returns. See that function for why.
 */
export const REQUEST_COLUMN_FIELD_KEYS: Readonly<Record<string, string>> = {
  sid: "sid",
  "jenis order": "jenisOrder",
  layanan: "layanan",
  "agreement name": "agreementName",
  "last order": "lastOrder",
  bw: "bandwidth",
  bandwidth: "bandwidth",
  alamat: "alamat",
  "harga otc": "hargaOtc",
  "harga bulanan": "hargaBulanan",
  akun: "akunBaru",
  "term of payment": "termOfPayment",
  "start date": "startDate",
  "end date": "endDate",
  keterangan: "keterangan",
  "nama pic dan pic": "picContacts",
  "nama pic": "picContacts",
  email: "email",
};

/**
 * Keys the reader maps but does not hand out as field values.
 *
 * `sid` is the service's IDENTITY, not one of its attributes: two services
 * necessarily carry two different SIDs, so putting it through the
 * cross-service agreement check below would manufacture a conflict on every
 * multi-service request and report "the services disagree" about the one thing
 * they are supposed to disagree about.
 *
 * `jenisOrder` is a docx HEADER cell, not an xlsx row, and it already has a
 * resolution order of its own in `resolveJenisOrder` -- operator flag, then
 * this request, then a printed label, then blank. Emitting it here as well
 * would give it a second, unranked path into the deliverable that bypasses the
 * operator's override, which is the one thing that order exists to guarantee.
 */
const NOT_FIELD_VALUES = new Set(["sid", "jenisOrder"]);

/**
 * A header reduced to the form the table above is keyed by.
 *
 * The parentheticals are dropped because the client uses them for instructions
 * to the operator, not for identity: `Jenis order (yang diminta)` and
 * `Start Date  (DD/MM/YY)` name the same fields as `Jenis order` and
 * `Start Date`. The trailing `baru` goes for the same reason -- `BW baru`,
 * `Alamat Baru` and `Harga OTC Baru` mean "the new value of", which is what
 * every column in a request holds.
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+baru$/, "")
    .trim();
}

/** Excel's own column letter for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * One cell as text, verbatim wherever "verbatim" is defined.
 *
 * The only two values that are not already text are numbers and dates, and
 * both are formatted here rather than left to `String()`:
 *
 * - A DATE IS FORMATTED FROM ITS UTC COMPONENTS. exceljs hands back a `Date`
 *   built at midnight UTC (`2026-08-21T00:00:00.000Z` in the bundle we have),
 *   so `getDate()` -- which is local -- returns the 20th anywhere west of
 *   Greenwich and the 21st everywhere else. A contract start date that is one
 *   day out depending on which machine ran the pipeline is exactly the
 *   plausible-and-wrong shape this project is organised against, and it would
 *   never reproduce for the person who reported it.
 * - THE YEAR IS FOUR DIGITS even though the header asks for `DD/MM/YY`. A
 *   two-digit year in a contract end date is ambiguous, this cell is signed by
 *   a validator, and four digits is strictly more information than two without
 *   ever being a different fact.
 *
 * A formula cell yields its cached RESULT, because that is what Excel shows
 * and what the operator copied from; a formula whose cached result is an error
 * yields "" rather than the error token, since `#REF!` in a workbook cell is
 * worse than a blank the outstanding report can name.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    const dd = String(value.getUTCDate()).padStart(2, "0");
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${value.getUTCFullYear()}`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return (record.richText as { text?: unknown }[])
        .map((run) => String(run.text ?? ""))
        .join("")
        .trim();
    }
    if ("error" in record) return "";
    if ("result" in record) return cellText(record.result);
    if ("text" in record) return cellText(record.text);
    if ("hyperlink" in record) return cellText(record.hyperlink);
  }
  return String(value).trim();
}

/** The plain-text grid the pure parser works on. `rows` is 0-based; row 0 is
 *  the worksheet's row 1. */
export type OrderRequestGrid = {
  file: string;
  sheet: string;
  rows: string[][];
};

/**
 * The whole mapping, over a grid of strings. Pure: no exceljs, no filesystem,
 * no clock.
 *
 * ROW 1 IS TYPE HINTS, ROW 2 IS HEADERS, ROWS 3+ ARE ONE SERVICE EACH. That
 * layout is the client's, recorded in the 2026-09-03 findings, and it is
 * asserted rather than sniffed: a file that does not have it is refused with a
 * message naming what was found. Guessing which row held the headers would let
 * a differently-shaped workbook parse into a plausible set of values keyed off
 * the wrong row, and nothing downstream could tell.
 */
export function parseOrderRequestGrid(grid: OrderRequestGrid): OrderRequest {
  const hintRow = grid.rows[0] ?? [];
  const headerRow = grid.rows[1] ?? [];
  const serviceRows = grid.rows.slice(2);

  const width = Math.max(
    hintRow.length,
    headerRow.length,
    ...serviceRows.map((row) => row.length),
    0,
  );

  const headers: {
    column: string;
    header: string;
    hint: string;
    fieldKey: string;
    index: number;
  }[] = [];
  const unmapped: UnmappedColumn[] = [];

  for (let index = 0; index < width; index++) {
    const column = columnLetter(index);
    const header = (headerRow[index] ?? "").trim();
    const hint = (hintRow[index] ?? "").trim();
    const hasData = serviceRows.some((row) => (row[index] ?? "").trim() !== "");

    if (header === "") {
      // A headerless column with data in it is reported, not skipped in
      // silence: it is either a layout the reader does not understand or a
      // field the client added, and both are things a human has to see. A
      // headerless column with no data is nothing at all.
      if (hasData) {
        unmapped.push({
          column,
          header: "",
          reason: "the column carries data but row 2 gives it no header",
        });
      }
      continue;
    }

    const fieldKey = REQUEST_COLUMN_FIELD_KEYS[normalizeHeader(header)];
    if (!fieldKey) {
      unmapped.push({
        column,
        header,
        reason:
          "no field key is mapped to this header; add it to " +
          "REQUEST_COLUMN_FIELD_KEYS once somebody has decided which cell it fills",
      });
      continue;
    }

    headers.push({ column, header, hint, fieldKey, index });
  }

  if (headers.length === 0) {
    throw new Error(
      `${grid.file} sheet "${grid.sheet}" has no readable order-request ` +
        `headers on row 2 (row 2 reads: ${JSON.stringify(headerRow.slice(0, 8))}). ` +
        "An order request is row 1 type hints, row 2 headers, one row per SID.",
    );
  }

  const sidColumn = headers.find((entry) => entry.fieldKey === "sid");
  const services: OrderRequestService[] = [];

  serviceRows.forEach((row, offset) => {
    // A row where every mapped cell is empty is spacing or a stray format, not
    // a service. Dropping it is safe in a way that dropping a column is not:
    // there is nothing in it to lose.
    const cells = headers
      .map((entry) => ({
        fieldKey: entry.fieldKey,
        header: entry.header,
        column: entry.column,
        hint: entry.hint,
        text: (row[entry.index] ?? "").trim(),
      }))
      .filter((cell) => cell.text !== "");
    if (cells.length === 0) return;

    services.push({
      row: offset + 3, // worksheet rows are 1-based and rows 1-2 are the header
      sid: sidColumn ? (row[sidColumn.index] ?? "").trim() : "",
      cells,
    });
  });

  const jenisOrderReadings = [
    ...new Set(
      services
        .flatMap((service) => service.cells)
        .filter((cell) => cell.fieldKey === "jenisOrder")
        .map((cell) => cell.text),
    ),
  ];

  return {
    file: grid.file,
    sheet: grid.sheet,
    services,
    // Blank unless every service that answered gave the same answer. Two
    // services asking for two different order types is a request the operator
    // has to settle -- `resolveJenisOrder` then falls through to the documents
    // and finally to a blank cell it reports by name, which is the outcome a
    // guess would have hidden.
    jenisOrder: jenisOrderReadings.length === 1 ? jenisOrderReadings[0] : "",
    jenisOrderReadings,
    unmapped,
  };
}

/** The grid behind one exceljs worksheet. */
export function gridFromWorksheet(
  worksheet: exceljs.Worksheet,
  file: string,
): OrderRequestGrid {
  const rows: string[][] = [];
  const width = Math.max(worksheet.actualColumnCount ?? 0, worksheet.columnCount ?? 0);
  const height = Math.max(worksheet.actualRowCount ?? 0, worksheet.rowCount ?? 0);
  for (let r = 1; r <= height; r++) {
    const row = worksheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return { file, sheet: worksheet.name, rows };
}

/**
 * An order request out of xlsx bytes. Injectable in the sense that matters:
 * it takes bytes, so a test builds its own workbook in memory and never
 * touches the filesystem, the network or `documents/`.
 *
 * THE FIRST WORKSHEET, and only the first. Both requests we have hold exactly
 * one sheet; picking "the one that looks like a request" out of several would
 * be a guess of exactly the kind the header table above refuses to make. A
 * workbook with more than one sheet is refused, naming them, so the operator
 * says which rather than the reader deciding.
 */
export async function readOrderRequestBuffer(
  bytes: Uint8Array,
  file: string,
): Promise<OrderRequest> {
  const workbook = new exceljs.Workbook();
  // exceljs wants a Node Buffer or an ArrayBuffer; a Uint8Array view may be a
  // window onto a larger buffer, so slice to this view's own bytes rather than
  // handing over `bytes.buffer`.
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );

  const sheets = workbook.worksheets;
  if (sheets.length === 0) throw new Error(`${file} has no worksheets`);
  if (sheets.length > 1) {
    throw new Error(
      `${file} has ${sheets.length} worksheets (${sheets
        .map((sheet) => JSON.stringify(sheet.name))
        .join(", ")}). An order request is one sheet; say which by exporting ` +
        "it on its own, rather than letting this reader pick.",
    );
  }

  return parseOrderRequestGrid(gridFromWorksheet(sheets[0], file));
}

/**
 * The services a selector names, or every service when it names none.
 *
 * A SID is matched before an ordinal, because a SID is the more specific
 * identity and both are digit strings: `--service 1209990001` must mean that
 * subscriber and not "the 1209990001th row". An ordinal is 1-based, matching
 * how the request's own rows read to a human looking at Excel.
 */
export function selectServices(
  request: OrderRequest,
  selector?: string,
): OrderRequestService[] {
  const wanted = (selector ?? "").trim();
  if (wanted === "") return request.services;

  const bySid = request.services.filter((service) => service.sid === wanted);
  if (bySid.length > 0) return bySid;

  const ordinal = /^\d+$/.test(wanted) ? Number(wanted) : NaN;
  const byOrdinal = request.services[ordinal - 1];
  if (byOrdinal) return [byOrdinal];

  throw new Error(
    `${request.file} has no service ${JSON.stringify(wanted)}. It lists ` +
      `${request.services.length}: ` +
      request.services
        .map((service, i) => `${i + 1} = ${service.sid || "(no SID)"}`)
        .join(", "),
  );
}

/**
 * The request's answers, as the `FieldValue`s the rest of the pipeline speaks.
 *
 * IT NEVER PICKS A SERVICE FOR YOU, and that is the whole design of this
 * function. Bundle two's request lists two SIDs whose rows agree on every
 * field except the SID and the address. `AO_TEMPLATE` models ONE service, so
 * something has to give, and the two candidate behaviours are not equally bad:
 *
 * - Take row 1 and ship it. The workbook opens, every cell is filled, and one
 *   of the two addresses is simply gone. Nothing anywhere says a second
 *   service existed. That is the wrong-and-quiet failure this project is
 *   organised against, and it is worse here than usual because both values are
 *   real -- there is no malformed-looking cell for a reviewer to catch.
 * - Ship the fields they AGREE on, and blank the ones they do not with every
 *   spelling recorded. Which is exactly what `reconcileFieldValues` already
 *   does for two documents that disagree, down to the `conflict` /
 *   `conflictReason` fields -- so `scripts/generate.mjs` already prints these,
 *   already reports them in `OUTSTANDING`, and already tells the operator what
 *   the two readings were. No new machinery, and the operator settles it in
 *   one edit or re-runs with `--service`.
 *
 * The second one. `--service <SID|n>` is the operator saying which, and a
 * one-service request never reaches the disagreement branch at all.
 */
export function orderRequestFieldValues(
  request: OrderRequest,
  options: { service?: string } = {},
): FieldValue[] {
  const services = selectServices(request, options.service);

  /** fieldKey -> the cells that answered it, in row order. */
  const answers = new Map<string, { service: OrderRequestService; cell: OrderRequestCell }[]>();
  const order: string[] = [];
  for (const service of services) {
    for (const cell of service.cells) {
      if (NOT_FIELD_VALUES.has(cell.fieldKey)) continue;
      if (cell.text === "") continue;
      const list = answers.get(cell.fieldKey);
      if (list) list.push({ service, cell });
      else {
        answers.set(cell.fieldKey, [{ service, cell }]);
        order.push(cell.fieldKey);
      }
    }
  }

  const values: FieldValue[] = [];
  for (const fieldKey of order) {
    const found = answers.get(fieldKey) ?? [];
    const spellings = [...new Set(found.map((entry) => entry.cell.text))];

    if (spellings.length > 1) {
      // Deliberately NO `requestSource`: the cell ships blank, and provenance
      // on a blank would be a note pointing at rows whose text is not in the
      // workbook. The conflict list names them instead.
      values.push({
        fieldKey,
        value: "",
        conflict: spellings,
        conflictReason:
          `the order request lists ${services.length} services and rows ` +
          `${found.map((entry) => entry.service.row).join(", ")} of ` +
          `${request.file} disagree; re-run with --service <SID> to take one`,
      });
      continue;
    }

    const first = found[0];
    values.push({
      fieldKey,
      value: first.cell.text,
      requestSource: {
        file: request.file,
        sheet: request.sheet,
        rows: found.map((entry) => entry.service.row),
        column: first.cell.column,
        header: first.cell.header,
      },
    });
  }

  return values;
}
