/**
 * email_setup tool -- Configure email account credentials.
 *
 * Stores a named profile. A profile is automatically set as active
 * if it's the first one. Use email_status to see all profiles.
 */

import { Type } from "typebox";
import { saveProfile } from "../config";
import type { EmailConfig, SetupParams } from "../types";

export const EmailSetupTool = {
  name: "email_setup",
  label: "Email Setup",
  description:
    "Configure your email account credentials (IMAP/SMTP). Call this first before using any other email tools. After setup, credentials are stored in ~/.pi/email-config.json.",
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
    fromName: Type.Optional(
      Type.String({ description: "Display name for outgoing emails" }),
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
      },
      smtp: {
        host: params.smtpHost,
        port: params.smtpPort,
        secure: params.smtpSecure,
        user: params.smtpUser,
        password: params.smtpPassword,
      },
      fromName: params.fromName,
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
