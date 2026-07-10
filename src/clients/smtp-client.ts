/**
 * SMTP client operations.
 *
 * Single responsibility: send emails via nodemailer.
 * Returns plain SendResult data.
 */

import nodemailer from "nodemailer";
import type { EmailConfig, SendParams, SendResult } from "../types.ts";

export interface SendOptions extends SendParams {
  /** Custom headers like In-Reply-To, References for threading */
  customHeaders?: Record<string, string>;
}

export async function sendEmail(
  config: EmailConfig,
  params: SendParams | SendOptions,
): Promise<SendResult> {
  for (const attachmentPath of params.attachmentPaths || []) {
    const isUrlOrDataUri =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(attachmentPath) ||
      /^data:/i.test(attachmentPath);
    if (isUrlOrDataUri) {
      throw new Error(`Only local attachment paths are supported: ${attachmentPath}`);
    }
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
    tls: config.smtp.tls
  });

  const fromName = config.fromName || config.smtp.user;

  const mailOptions: any = {
    from: `"${fromName}" <${config.smtp.user}>`,
    to: params.to,
    subject: params.subject,
    text: params.body,
    disableUrlAccess: true,
  };

  if (params.cc) mailOptions.cc = params.cc;
  if (params.bcc) mailOptions.bcc = params.bcc;
  if (params.html) mailOptions.html = params.html;
  if (params.attachmentPaths?.length) {
    mailOptions.attachments = params.attachmentPaths.map((path) => ({ path }));
  }

  // Apply custom headers (e.g. In-Reply-To, References)
  const opts = params as SendOptions;
  if (opts.customHeaders) {
    for (const [key, value] of Object.entries(opts.customHeaders)) {
      mailOptions[key] = value;
    }
  }

  const info = await transporter.sendMail(mailOptions);

  return {
    messageId: info.messageId,
    to: params.to,
    subject: params.subject,
  };
}
