/**
 * email_status tool -- Show current email configuration status.
 */

import { Type } from "typebox";
import { getConfig } from "../config";
import {
  formatConfiguredStatus,
  formatNotConfiguredStatus,
} from "../formatting/formatters";

export const EmailStatusTool = {
  name: "email_status",
  label: "Email Status",
  description:
    "Show current email configuration status (which account is configured).",
  parameters: Type.Object({}),

  execute(_toolCallId: string, _params: {}, _signal: AbortSignal) {
    const config = getConfig();

    if (!config) {
      return {
        content: [{ type: "text" as const, text: formatNotConfiguredStatus() }],
        details: { configured: false },
      };
    }

    const text = formatConfiguredStatus(
      config.imap.host,
      config.imap.port,
      config.imap.tls,
      config.imap.user,
      config.smtp.host,
      config.smtp.port,
      config.smtp.secure,
      config.smtp.user,
      config.fromName,
    );

    return {
      content: [{ type: "text" as const, text }],
      details: { configured: true },
    };
  },
};
