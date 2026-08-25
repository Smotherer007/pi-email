/**
 * email_setup tool -- Configure email account credentials.
 *
 * Stores a named profile. A profile is automatically set as active
 * if it's the first one. Use email_status to see all profiles and
 * email_profile to switch between them.
 */

import { Type } from "typebox";
import { saveProfile } from "../config.ts";
import type { EmailConfig, SetupParams } from "../types.ts";

export const EmailSetupTool = {
  name: "email_setup",
  label: "Email Setup",
  description:
    "Configure your email account credentials (IMAP/SMTP). Call this first before using any other email tools. After setup, credentials are stored in ~/.pi/email-config.json (readable only by you).",
  parameters: Type.Object({
    name: Type.String({
      description: "Profile name, e.g. 'work', 'personal', 'gmail'. Use a short, memorable name.",
    }),
    imapHost: Type.String({
      description: "IMAP server hostname, e.g. imap.gmail.com",
    }),
    imapPort: Type.Number({
      description: "IMAP port, usually 993",
      default: 993,
    }),
    imapTls: Type.Boolean({
      description: "Use TLS for IMAP",
      default: true,
    }),
    imapUser: Type.String({
      description: "IMAP username (usually your full email)",
    }),
    imapPassword: Type.String({
      description: "IMAP password or app-specific password",
    }),
    imapRejectUnauthorized: Type.Optional(
      Type.Boolean({
        description:
          "Whether to validate the IMAP server TLS certificate. Defaults to true. Set to false only for local bridges such as ProtonMail Bridge.",
      }),
    ),
    smtpHost: Type.String({
      description: "SMTP server hostname, e.g. smtp.gmail.com",
    }),
    smtpPort: Type.Number({
      description: "SMTP port, 465 or 587",
      default: 587,
    }),
    smtpSecure: Type.Boolean({
      description: "Use SSL/TLS for SMTP",
      default: false,
    }),
    smtpUser: Type.String({
      description: "SMTP username (usually same as IMAP)",
    }),
    smtpPassword: Type.String({
      description: "SMTP password or app-specific password",
    }),
    smtpRejectUnauthorized: Type.Optional(
      Type.Boolean({
        description: "Whether to validate the SMTP server TLS certificate. Set to false for ProtonMail Bridge.",
      }),
    ),
    fromName: Type.Optional(
      Type.String({ description: "Display name for outgoing emails" }),
    ),
    appendToSent: Type.Optional(
      Type.Boolean({
        description:
          "Store a copy of outgoing mail in the Sent folder via IMAP. Defaults to true, except for Gmail, which does this server-side.",
      }),
    ),
    sentMailbox: Type.Optional(
      Type.String({
        description:
          "Explicit Sent mailbox name. Leave empty to auto-detect it from the server's folder list.",
      }),
    ),
  }),

  execute(_toolCallId: string, params: SetupParams, _signal: AbortSignal) {
    const config: EmailConfig = {
      imap: {
        host: params.imapHost,
        port: params.imapPort,
        tls: params.imapTls,
        user: params.imapUser,
        password: params.imapPassword,
        ...(params.imapRejectUnauthorized !== undefined && {
          rejectUnauthorized: params.imapRejectUnauthorized,
        }),
      },
      smtp: {
        host: params.smtpHost,
        port: params.smtpPort,
        secure: params.smtpSecure,
        user: params.smtpUser,
        password: params.smtpPassword,
        ...(params.smtpRejectUnauthorized !== undefined && {
          tls: { rejectUnauthorized: params.smtpRejectUnauthorized }
        })
      },
      fromName: params.fromName,
      ...(params.appendToSent !== undefined && { appendToSent: params.appendToSent }),
      ...(params.sentMailbox !== undefined && { sentMailbox: params.sentMailbox }),
    };

    saveProfile(params.name, config);

    return {
      content: [
        {
          type: "text" as const,
          text: `Email profile "${params.name}" saved and set as active. You can now use all email tools.`,
        },
      ],
      details: { profileName: params.name, configSaved: true },
    };
  },
};
