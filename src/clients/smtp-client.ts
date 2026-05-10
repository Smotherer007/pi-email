/**
 * SMTP client operations.
 *
 * Single responsibility: send emails via nodemailer.
 * Returns plain SendResult data.
 */

import nodemailer from "nodemailer";
import type { EmailConfig, SendParams, SendResult } from "../types";

export async function sendEmail(
  config: EmailConfig,
  params: SendParams,
): Promise<SendResult> {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
  });

  const fromName = config.fromName || config.smtp.user;

  const mailOptions: any = {
    from: `"${fromName}" <${config.smtp.user}>`,
    to: params.to,
    subject: params.subject,
    text: params.body,
  };

  if (params.cc) mailOptions.cc = params.cc;
  if (params.bcc) mailOptions.bcc = params.bcc;
  if (params.html) mailOptions.html = params.html;

  const info = await transporter.sendMail(mailOptions);

  return {
    messageId: info.messageId,
    to: params.to,
    subject: params.subject,
  };
}
