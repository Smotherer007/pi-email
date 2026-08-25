/**
 * email_send tool -- Send an email via SMTP.
 */

import { Type } from "typebox";
import { deliverEmail } from "../delivery.ts";
import { resolveConfig } from "../config.ts";
import { formatSendResult, formatSentCopy } from "../formatting/formatters.ts";
import type { SendParams } from "../types.ts";

export const EmailSendTool = {
  name: "email_send",
  label: "Send Email",
  description:
    "Send an email via SMTP. Supports plain text, HTML, CC, BCC, and local file attachments. A copy is stored in the Sent mailbox unless the provider does that itself.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    to: Type.String({
      description: "Recipient email address(es), comma-separated",
    }),
    subject: Type.String({ description: "Email subject" }),
    body: Type.String({ description: "Email body (plain text)" }),
    cc: Type.Optional(Type.String({ description: "CC recipient(s)" })),
    bcc: Type.Optional(Type.String({ description: "BCC recipient(s)" })),
    html: Type.Optional(
      Type.String({
        description: "HTML body (optional, overrides plain text display)",
      }),
    ),
    attachmentPaths: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Local filesystem path to attach. Absolute paths recommended; URLs/data URIs are not supported.",
        }),
      ),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: SendParams,
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const { result, sentCopy } = await deliverEmail(config, params, signal);
    const text = `${formatSendResult(result)}\n${formatSentCopy(sentCopy)}`;

    return {
      content: [{ type: "text" as const, text }],
      details: { messageId: result.messageId, sentCopy },
    };
  },
};
