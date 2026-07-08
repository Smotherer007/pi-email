/**
 * email_forward tool -- Forward an email.
 *
 * Reads the original email and forwards it to new recipients.
 * Attachments from the original are included as references in the body
 * (re-attaching them requires the files to be saved locally first via email_read).
 */

import { Type } from "typebox";
import { readEmail } from "../clients/imap-client";
import { sendEmail } from "../clients/smtp-client";
import { resolveConfig } from "../config";

export const EmailForwardTool = {
  name: "email_forward",
  label: "Forward Email",
  description:
    "Forward an email by UID to new recipients. Includes the original email text with forwarding headers. To forward with the original attachments, first use email_read with downloadDir, then use email_send with attachmentPaths.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to forward (from email_fetch)" }),
    to: Type.String({ description: "Recipient email address(es), comma-separated" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox containing the original email, defaults to INBOX" }),
    ),
    body: Type.Optional(
      Type.String({ description: "Additional comment to include above the forwarded message" }),
    ),
    cc: Type.Optional(Type.String({ description: "CC recipient(s)" })),
    bcc: Type.Optional(Type.String({ description: "BCC recipient(s)" })),
  }),

  async execute(
    _toolCallId: string,
    params: {
      profile?: string;
      uid: number;
      to: string;
      mailbox?: string;
      body?: string;
      cc?: string;
      bcc?: string;
    },
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";

    // Read the original email
    const { parsed } = await readEmail(config, params.uid, mailbox, null, signal);

    // Build forwarded message body
    const parts: string[] = [];

    if (params.body) {
      parts.push(params.body);
      parts.push("");
    }

    parts.push("---------- Forwarded message ----------");
    parts.push(`From: ${parsed.from?.text || ""}`);
    parts.push(`Date: ${parsed.date?.toISOString() || ""}`);
    parts.push(`Subject: ${parsed.subject || ""}`);
    parts.push(`To: ${parsed.to?.text || ""}`);
    if (parsed.cc?.text) {
      parts.push(`CC: ${parsed.cc.text}`);
    }

    if (parsed.attachments?.length) {
      const names = parsed.attachments
        .map((a: any) => a.filename || "unnamed")
        .join(", ");
      parts.push(`Attachments: ${names}`);
    }

    parts.push("");
    parts.push(parsed.text || "(no text content)");

    const forwardBody = parts.join("\n");

    const result = await sendEmail(config, {
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: `Fwd: ${parsed.subject || "(no subject)"}`,
      body: forwardBody,
    });

    const text = `Email forwarded successfully.\nTo: ${result.to}\nSubject: ${result.subject}\nMessage-ID: ${result.messageId}`;

    const attachmentCount = parsed.attachments?.length || 0;

    return {
      content: [{ type: "text" as const, text }],
      details: {
        originalUid: params.uid,
        to: result.to,
        subject: result.subject,
        messageId: result.messageId,
        attachmentCount,
      },
    };
  },
};
