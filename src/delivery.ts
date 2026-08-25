/**
 * Outgoing message delivery.
 *
 * Sends a message and then stores a copy in the Sent mailbox via IMAP APPEND.
 * SMTP delivery and the Sent copy are separate operations against different
 * servers: the copy is best-effort and never turns a delivered message into a
 * reported failure -- the caller gets a status instead.
 */

import { appendToSent } from "./clients/imap-client.ts";
import { sendEmail } from "./clients/smtp-client.ts";
import type { SendOptions } from "./clients/smtp-client.ts";
import type {
  EmailConfig,
  SendParams,
  SendResult,
  SentCopyStatus,
} from "./types.ts";

/**
 * Providers that file outgoing mail into Sent themselves. Appending there
 * would leave the user with every sent message twice.
 */
const SERVER_SIDE_SENT_HOSTS = [
  /(^|\.)gmail\.com$/i,
  /(^|\.)googlemail\.com$/i,
];

export function savesSentCopyServerSide(config: EmailConfig): boolean {
  const host = config.smtp?.host || "";
  return SERVER_SIDE_SENT_HOSTS.some((pattern) => pattern.test(host));
}

export interface DeliveryResult {
  readonly result: SendResult;
  readonly sentCopy: SentCopyStatus;
}

export async function deliverEmail(
  config: EmailConfig,
  params: SendParams | SendOptions,
  signal?: AbortSignal,
): Promise<DeliveryResult> {
  const sent = await sendEmail(config, params);
  const result: SendResult = {
    messageId: sent.messageId,
    to: sent.to,
    subject: sent.subject,
  };

  if (config.appendToSent === false) {
    return {
      result,
      sentCopy: { status: "skipped", reason: "disabled for this profile" },
    };
  }

  if (config.appendToSent === undefined && savesSentCopyServerSide(config)) {
    return {
      result,
      sentCopy: {
        status: "skipped",
        reason: "provider files sent mail server-side",
      },
    };
  }

  try {
    const mailbox = await appendToSent(config, sent.raw, signal);
    if (!mailbox) {
      return {
        result,
        sentCopy: {
          status: "skipped",
          reason: "no Sent mailbox found; set sentMailbox in the profile",
        },
      };
    }
    return { result, sentCopy: { status: "saved", mailbox } };
  } catch (err) {
    return {
      result,
      sentCopy: {
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
