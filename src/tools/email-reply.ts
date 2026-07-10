/**
 * email_reply tool -- Reply to an email.
 *
 * Reads the original email to extract Message-ID and References headers,
 * then sends a reply with proper threading headers. Supports optional
 * quoting of the original message and reply-all.
 */

import { Type } from "typebox";
import { readEmail } from "../clients/imap-client.ts";
import { sendEmail } from "../clients/smtp-client.ts";
import { resolveConfig } from "../config.ts";

export const EmailReplyTool = {
  name: "email_reply",
  label: "Reply to Email",
  description:
    "Reply to an email by UID. Automatically sets In-Reply-To and References headers for proper threading. Optionally quotes the original message. Use replyAll to include all original recipients.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to reply to (from email_fetch)" }),
    body: Type.String({ description: "Reply body text" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox containing the original email, defaults to INBOX" }),
    ),
    html: Type.Optional(
      Type.String({ description: "HTML reply body (optional)" }),
    ),
    quoteOriginal: Type.Optional(
      Type.Boolean({ description: "Include original email text below your reply", default: true }),
    ),
    replyAll: Type.Optional(
      Type.Boolean({ description: "Reply to all original recipients (CC)", default: false }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: {
      profile?: string;
      uid: number;
      body: string;
      mailbox?: string;
      html?: string;
      quoteOriginal?: boolean;
      replyAll?: boolean;
    },
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";

    // Read the original email to get headers and recipients
    const { parsed } = await readEmail(config, params.uid, mailbox, null, signal);

    const messageId = (parsed as any).messageId || "";
    const existingReferences = (parsed as any).references || "";

    // Build quoted reply body
    const quotedBody = (params.quoteOriginal !== false) && parsed.text
      ? `${params.body}\n\n--- Original message ---\n> From: ${parsed.from?.text || ""}\n> Date: ${parsed.date?.toISOString() || ""}\n> Subject: ${parsed.subject || ""}\n>\n> ${parsed.text?.replace(/\n/g, "\n> ") || ""}`
      : params.body;

    // Determine "To" recipient: reply to the sender
    const to = parsed.from?.value?.[0]?.address || parsed.from?.text || "";

    // Determine CC for reply-all
    let cc = "";
    if (params.replyAll) {
      const toAddr = parsed.to?.value?.map((a: any) => a.address).filter(Boolean) || [];
      const ccAddr = parsed.cc?.value?.map((a: any) => a.address).filter(Boolean) || [];
      const fromAddr = parsed.from?.value?.[0]?.address || "";
      cc = [...toAddr, ...ccAddr]
        .filter((a: string) => a !== fromAddr)
        .join(", ");
    }

    // Build references chain for proper threading.
    // If the original already has references, append our messageId.
    // Otherwise start a new chain with just the original messageId.
    const refs = existingReferences
      ? `${existingReferences} ${messageId}`
      : messageId;

    const result = await sendEmail(config, {
      to,
      cc: cc || undefined,
      subject: `Re: ${parsed.subject || "(no subject)"}`,
      body: quotedBody,
      html: params.html,
      customHeaders: {
        inReplyTo: messageId,
        references: refs,
      },
    });

    const text = `Reply sent successfully.\nTo: ${result.to}\nSubject: ${result.subject}\nMessage-ID: ${result.messageId}`;
    if (cc) {
      return {
        content: [{ type: "text" as const, text: `${text}\nCC: ${cc}` }],
        details: { originalUid: params.uid, to: result.to, cc, subject: result.subject, messageId: result.messageId },
      };
    }

    return {
      content: [{ type: "text" as const, text }],
      details: { originalUid: params.uid, to: result.to, subject: result.subject, messageId: result.messageId },
    };
  },
};
