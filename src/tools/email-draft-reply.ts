/**
 * email_draft_reply tool -- Create a reply draft without sending.
 *
 * Reads the original email, composes an RFC 822 draft with threading headers
 * and an X-Unsent marker, then appends it to the server's Drafts mailbox with
 * the \Draft flag. Nothing is ever sent: the draft is meant to be reviewed
 * and sent by the user from their mail client.
 */

import { Type } from "typebox";
import { appendDraftMessage, readEmail } from "../clients/imap-client.ts";
import { resolveConfig } from "../config.ts";
import { buildReferences, buildReplyRecipients } from "../reply.ts";

/** Strip CR/LF from a header value to prevent header injection. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Avoid stacking "Re: Re: Re:" on an already-prefixed subject. */
function ensureReplySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

function buildDraftEml(input: {
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
}): string {
  const headers = [
    // X-Unsent is the conventional marker that tells mail clients this is a
    // draft that was never sent (Thunderbird and others honour it).
    "X-Unsent: 1",
    `From: ${sanitizeHeader(input.from)}`,
    `To: ${sanitizeHeader(input.to)}`,
    input.cc ? `Cc: ${sanitizeHeader(input.cc)}` : "",
    `Subject: ${sanitizeHeader(input.subject)}`,
    input.inReplyTo ? `In-Reply-To: ${sanitizeHeader(input.inReplyTo)}` : "",
    input.references ? `References: ${sanitizeHeader(input.references)}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);

  return `${headers.join("\r\n")}\r\n\r\n${input.body.replace(/\r?\n/g, "\r\n")}\r\n`;
}

export const EmailDraftReplyTool = {
  name: "email_draft_reply",
  label: "Draft Email Reply",
  description:
    "Create a server-side reply draft (IMAP \\Draft) for manual review instead of sending. Reads the original email to set threading headers, then appends the draft to the Drafts mailbox.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to reply to (from email_fetch)" }),
    body: Type.String({ description: "Draft reply body text" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox containing the original email, defaults to INBOX" }),
    ),
    draftMailbox: Type.Optional(
      Type.String({ description: "IMAP mailbox to store the draft in, defaults to Drafts" }),
    ),
    quoteOriginal: Type.Optional(
      Type.Boolean({ description: "Include original email text below your reply", default: true }),
    ),
    replyAll: Type.Optional(
      Type.Boolean({ description: "Include all original recipients as CC", default: false }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: {
      profile?: string;
      uid: number;
      body: string;
      mailbox?: string;
      draftMailbox?: string;
      quoteOriginal?: boolean;
      replyAll?: boolean;
    },
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";
    const draftMailbox = params.draftMailbox || "Drafts";

    const { parsed } = await readEmail(config, params.uid, mailbox, null, signal);

    const messageId = (parsed as any).messageId || "";
    const references = buildReferences((parsed as any).references, messageId);

    const quotedBody =
      (params.quoteOriginal !== false) && parsed.text
        ? `${params.body}\n\n--- Original message ---\n> From: ${parsed.from?.text || ""}\n> Date: ${parsed.date?.toISOString() || ""}\n> Subject: ${parsed.subject || ""}\n>\n> ${parsed.text?.replace(/\n/g, "\n> ") || ""}`
        : params.body;

    const { to, cc } = buildReplyRecipients(
      parsed,
      config.smtp.user,
      params.replyAll === true,
    );

    const subject = ensureReplySubject(parsed.subject || "(no subject)");
    const from = config.fromName
      ? `${config.fromName} <${config.smtp.user}>`
      : config.smtp.user;

    const eml = buildDraftEml({
      from,
      to,
      cc,
      subject,
      body: quotedBody,
      inReplyTo: messageId,
      references: references.join(" "),
    });

    await appendDraftMessage(config, draftMailbox, eml, signal);

    const lines = [
      `Draft reply saved to "${draftMailbox}" and not sent.`,
      `To: ${to}`,
    ];
    if (cc) lines.push(`CC: ${cc}`);
    lines.push(`Subject: ${subject}`);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: {
        originalUid: params.uid,
        mailbox,
        draftMailbox,
        to,
        ...(cc ? { cc } : {}),
        subject,
      },
    };
  },
};
