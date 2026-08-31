"use client";

import { generateId } from "ai";
import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  ThreadUserMessagePart,
} from "@assistant-ui/react";
import { DEFAULT_PAGE_LIMIT, renderPdfToImages } from "./pdf";
import { extractDocumentText, extractSpreadsheetText } from "./office";

/**
 * Turns a dropped file into parts the model can actually read.
 *
 * The default assistant-ui adapter advertises `accept: "*"` and forwards
 * every file verbatim. Against this stack that produces failures only after
 * the message is sent -- a spreadsheet dies inside the AI SDK provider
 * ("file part media type ... not supported"). Those surface in the UI as a
 * bare "An error occurred."
 *
 * So the composer accepts only what this adapter can convert, and conversion
 * happens at send time, in the browser.
 */

const SPREADSHEET =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCUMENT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Both the file picker filter and the guard for drag-and-drop, which bypasses
 * the picker entirely. Extensions are listed alongside MIME types because
 * Windows reports an empty `type` for some Office files.
 */
export const ACCEPTED_FILE_TYPES = [
  "image/*",
  "text/*",
  "application/json",
  "application/pdf",
  SPREADSHEET,
  DOCUMENT,
  ".pdf",
  ".xlsx",
  ".docx",
  ".csv",
  ".md",
  ".txt",
  ".json",
].join(",");

const isImage = (file: File) => file.type.startsWith("image/");

const isTextual = (file: File) =>
  file.type.startsWith("text/") ||
  file.type === "application/json" ||
  /\.(txt|md|csv|tsv|json|log|ya?ml)$/i.test(file.name);

const isPdf = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

const isSpreadsheet = (file: File) =>
  file.type === SPREADSHEET || /\.xlsx$/i.test(file.name);

const isDocument = (file: File) =>
  file.type === DOCUMENT || /\.docx$/i.test(file.name);

const isSupported = (file: File) =>
  isImage(file) ||
  isTextual(file) ||
  isPdf(file) ||
  isSpreadsheet(file) ||
  isDocument(file);

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(blob);
  });

const textPart = (text: string): ThreadUserMessagePart => ({
  type: "text",
  text,
});

/** Converts one file into the message parts to send. */
const convert = async (file: File): Promise<ThreadUserMessagePart[]> => {
  if (isImage(file)) {
    return [{ type: "image", image: await toDataUrl(file) }];
  }

  if (isPdf(file)) {
    const { pages, totalPages, truncated } = await renderPdfToImages(file);

    if (pages.length === 0) {
      return [textPart(`[${file.name}: the PDF has no renderable pages.]`)];
    }

    const images = await Promise.all(
      pages.map(async (page): Promise<ThreadUserMessagePart> => {
        return { type: "image", image: await toDataUrl(page) };
      }),
    );

    // State the truncation in the prompt itself, so the model does not answer
    // about page 12 as though it had seen it.
    const caption = truncated
      ? `[${file.name}: showing the first ${pages.length} of ${totalPages} pages. ` +
        `The remaining pages were not sent, because each page costs roughly 256 ` +
        `tokens of the model's 8192-token context.]`
      : `[${file.name}: ${totalPages} page${totalPages === 1 ? "" : "s"}, rendered as images.]`;

    return [textPart(caption), ...images];
  }

  if (isSpreadsheet(file)) {
    return [
      textPart(
        `[${file.name}, converted to CSV]\n\n${await extractSpreadsheetText(file)}`,
      ),
    ];
  }

  if (isDocument(file)) {
    return [
      textPart(`[${file.name}]\n\n${await extractDocumentText(file)}`),
    ];
  }

  if (isTextual(file)) {
    return [textPart(`[${file.name}]\n\n${await file.text()}`)];
  }

  throw new Error(
    `${file.name} is a ${file.type || "unrecognized"} file, which this model cannot read. ` +
      `Supported: images, PDF, .xlsx, .docx, and text files.`,
  );
};

const attachmentKind = (file: File): PendingAttachment["type"] =>
  isImage(file) ? "image" : "document";

export const createLocalAttachmentAdapter = (): AttachmentAdapter => ({
  accept: ACCEPTED_FILE_TYPES,

  async add({ file }): Promise<PendingAttachment> {
    // Drag-and-drop skips the picker's accept filter, so reject here too --
    // before the file is attached rather than after the send fails.
    if (!isSupported(file)) {
      return {
        id: generateId(),
        type: "file",
        name: file.name,
        file,
        contentType: file.type,
        content: [],
        status: {
          type: "incomplete",
          reason: "error",
          message:
            `${file.type || "This file type"} cannot be read by a vision model. ` +
            `Attach an image, PDF, .xlsx, .docx, or a text file.`,
        },
      };
    }

    return {
      id: generateId(),
      type: attachmentKind(file),
      name: file.name,
      file,
      contentType: file.type,
      content: [],
      // Conversion is deferred to send() so picking a large PDF does not
      // freeze the composer.
      status: { type: "requires-action", reason: "composer-send" },
    };
  },

  async send(attachment): Promise<CompleteAttachment> {
    const content = await convert(attachment.file);

    return {
      ...attachment,
      status: { type: "complete" },
      content,
    };
  },

  async remove() {},
});

export const PDF_PAGE_LIMIT = DEFAULT_PAGE_LIMIT;
