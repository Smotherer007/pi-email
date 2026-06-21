/**
 * email_send tool -- Send an email via SMTP.
 */

import { Type } from "typebox";
import { sendEmail } from "../clients/smtp-client";
import { resolveConfig } from "../config";
import { formatSendResult } from "../formatting/formatters";
import type { SendParams } from "../types";

export const EmailSendTool = {
  name: "email_send",
  label: "Send Email",
  description:
    "Send an email via SMTP. Supports plain text, HTML, CC, BCC, and local file attachments.",
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
    _signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const result = await sendEmail(config, params);
    const text = formatSendResult(result);

    return {
      content: [{ type: "text" as const, text }],
      details: { messageId: result.messageId },
    };
  },
};
