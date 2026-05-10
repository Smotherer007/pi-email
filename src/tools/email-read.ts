/**
 * email_read tool -- Read full body of a specific email by UID.
 */

import { Type } from "typebox";
import { readEmail } from "../clients/imap-client";
import { getConfigOrThrow } from "../config";
import { formatEmailBody } from "../formatting/formatters";
import { extractPdfsFromAttachments } from "../pdf-reader";
import type { AttachmentInfo, EmailBody, EmailConfig, PdfContent, ReadParams } from "../types";

export const EmailReadTool = {
  name: "email_read",
  label: "Read Email",
  description:
    "Read the full body of a specific email by UID. Returns subject, from, date, and the full text body. Use downloadDir to save attachments. PDF attachments are automatically extracted and their text content included.",
  parameters: Type.Object({
    uid: Type.Number({ description: "Email UID from email_fetch" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
    downloadDir: Type.Optional(
      Type.String({
        description: "Optional: directory to save email attachments to",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: ReadParams,
    _signal: AbortSignal,
  ) {
    const config: EmailConfig = getConfigOrThrow();
    const mailbox = params.mailbox || "INBOX";

    const { parsed, savedFiles } = await readEmail(
      config,
      params.uid,
      mailbox,
      params.downloadDir || null,
    );

    const attachments: AttachmentInfo[] = (parsed.attachments || []).map(
      (a) => ({
        filename: a.filename || "unnamed",
        contentType: a.contentType || "unknown",
        sizeKb: Math.round((a.size || 0) / 1024),
      }),
    );

    // Extract text from PDF attachments
    let pdfTexts: PdfContent[] = [];
    if (savedFiles.length > 0) {
      pdfTexts = [...(await extractPdfsFromAttachments(savedFiles))];
    }

    const body: EmailBody = {
      uid: params.uid,
      from: parsed.from?.text || "",
      to: parsed.to?.text || "",
      cc: parsed.cc?.text || "",
      subject: parsed.subject || "(no subject)",
      date: parsed.date?.toISOString() || "",
      text: parsed.text || "(no text content)",
      attachments,
      pdfTexts,
    };

    const text = formatEmailBody(body, savedFiles);

    return {
      content: [{ type: "text" as const, text }],
      details: {
        uid: params.uid,
        subject: body.subject,
        attachmentCount: attachments.length,
        pdfCount: pdfTexts.length,
        savedFiles,
      },
    };
  },
};
