/**
 * email_reply tool -- Reply to an email.
 *
 * Reads the original email to extract Message-ID and References headers,
 * then sends a reply with proper threading headers. Supports optional
 * quoting of the original message and reply-all.
 */

import { Type } from "typebox";
import { readEmail, setFlags } from "../clients/imap-client.ts";
import { deliverEmail } from "../delivery.ts";
import { resolveConfig } from "../config.ts";
import { formatSentCopy } from "../formatting/formatters.ts";

/** Recipients of a reply, derived from the original message's headers. */
export function buildReplyRecipients(
  parsed: any,
  ownAddress: string,
  replyAll: boolean,
): { to: string; cc: string } {
  // Reply-To wins over From when present -- that is the whole point of the
  // header, and mailing lists and no-reply senders rely on it.
  const replyTo = parsed.replyTo?.value?.map((a: any) => a.address).filter(Boolean) || [];
  const fromAddress = parsed.from?.value?.[0]?.address || "";
  const to =
    replyTo.length > 0
      ? replyTo.join(", ")
      : fromAddress || parsed.from?.text || "";

  if (!replyAll) return { to, cc: "" };

  const normalized = (value: string) => value.trim().toLowerCase();
  const alreadyAddressed = new Set(
    [...replyTo, fromAddress, ownAddress].filter(Boolean).map(normalized),
  );

  const toAddresses = parsed.to?.value?.map((a: any) => a.address).filter(Boolean) || [];
  const ccAddresses = parsed.cc?.value?.map((a: any) => a.address).filter(Boolean) || [];

  const cc: string[] = [];
  for (const address of [...toAddresses, ...ccAddresses]) {
    const key = normalized(address);
    // Skips the sender, the Reply-To target, our own address (replying to all
    // used to CC the sender back to themselves) and duplicates.
    if (alreadyAddressed.has(key)) continue;
    alreadyAddressed.add(key);
    cc.push(address);
  }

  return { to, cc: cc.join(", ") };
}

/** Build the References chain for the reply. */
export function buildReferences(
  existing: string | ReadonlyArray<string> | undefined,
  messageId: string,
): string[] {
  const chain = Array.isArray(existing)
    ? [...existing]
    : existing
      ? [existing]
      : [];
  if (messageId && !chain.includes(messageId)) chain.push(messageId);
  return chain;
}

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
    const references = buildReferences((parsed as any).references, messageId);

    const quotedBody = (params.quoteOriginal !== false) && parsed.text
      ? `${params.body}\n\n--- Original message ---\n> From: ${parsed.from?.text || ""}\n> Date: ${parsed.date?.toISOString() || ""}\n> Subject: ${parsed.subject || ""}\n>\n> ${parsed.text?.replace(/\n/g, "\n> ") || ""}`
      : params.body;

    const { to, cc } = buildReplyRecipients(
      parsed,
      config.smtp.user,
      params.replyAll === true,
    );

    const subject = parsed.subject || "(no subject)";
    const { result, sentCopy } = await deliverEmail(
      config,
      {
        to,
        cc: cc || undefined,
        // Do not stack "Re: Re: Re:" on an already-prefixed subject.
        subject: /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`,
        body: quotedBody,
        html: params.html,
        inReplyTo: messageId,
        references,
      },
      signal,
    );

    // Marking the original as answered is a courtesy to every other mail
    // client looking at this mailbox; failing at it must not fail the reply.
    let answeredFlagSet = true;
    try {
      await setFlags(config, params.uid, mailbox, ["\\Answered"], [], signal);
    } catch {
      answeredFlagSet = false;
    }

    const lines = [
      "Reply sent successfully.",
      `To: ${result.to}`,
    ];
    if (cc) lines.push(`CC: ${cc}`);
    lines.push(`Subject: ${result.subject}`);
    lines.push(`Message-ID: ${result.messageId}`);
    lines.push(formatSentCopy(sentCopy));

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: {
        originalUid: params.uid,
        to: result.to,
        ...(cc ? { cc } : {}),
        subject: result.subject,
        messageId: result.messageId,
        sentCopy,
        answeredFlagSet,
      },
    };
  },
};
