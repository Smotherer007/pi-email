/**
 * SMTP client operations.
 *
 * Single responsibility: build and send messages via nodemailer.
 *
 * The message is composed once into its raw RFC822 form and that exact byte
 * sequence is handed to the SMTP transport. The caller gets the same bytes
 * back, which is what lets the Sent-folder copy be identical to what the
 * recipient received -- same Message-ID, same Date, same body.
 */

import nodemailer from "nodemailer";
import * as os from "node:os";
import * as path from "node:path";
import type { EmailConfig, SendParams, SendResult } from "../types.ts";

export interface SendOptions extends SendParams {
  /** Message-ID of the message being answered (threading). */
  inReplyTo?: string;
  /** Full References chain. An array is joined the way RFC 5322 requires. */
  references?: string | ReadonlyArray<string>;
  /** Additional raw headers. */
  headers?: Record<string, string>;
}

export interface SentMessage extends SendResult {
  /** The exact bytes handed to the SMTP server. */
  readonly raw: Buffer;
}

/** Directory holding the credential store -- never attachable. */
function configDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.resolve(path.join(home, ".pi"));
}

function assertSafeAttachment(attachmentPath: string): void {
  const isUrlOrDataUri =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(attachmentPath) ||
    /^data:/i.test(attachmentPath);
  if (isUrlOrDataUri) {
    throw new Error(
      `Only local attachment paths are supported: ${attachmentPath}`,
    );
  }

  // The agent acts on the contents of untrusted incoming mail, so a message
  // that talks it into attaching the credential store must not succeed.
  const resolved = path.resolve(attachmentPath);
  const dir = configDir();
  if (resolved === dir || resolved.startsWith(dir + path.sep)) {
    throw new Error(
      `Refusing to attach a file from the pi configuration directory: ${attachmentPath}`,
    );
  }
}

/** Reject header injection via CR/LF in address or subject fields. */
function assertSingleLine(value: string | undefined, field: string): void {
  if (value === undefined) return;
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error(`Line breaks are not allowed in the ${field} field.`);
  }
}

function buildMailOptions(
  config: EmailConfig,
  params: SendParams | SendOptions,
): Record<string, unknown> {
  for (const attachmentPath of params.attachmentPaths || []) {
    assertSafeAttachment(attachmentPath);
  }

  assertSingleLine(params.to, "to");
  assertSingleLine(params.cc, "cc");
  assertSingleLine(params.bcc, "bcc");
  assertSingleLine(params.subject, "subject");

  const mailOptions: Record<string, unknown> = {
    // Object form so nodemailer does the quoting and RFC 2047 encoding.
    // The old template string broke on display names containing a quote.
    from: { name: config.fromName || config.smtp.user, address: config.smtp.user },
    to: params.to,
    subject: params.subject,
    text: params.body,
    disableUrlAccess: true,
  };

  if (params.cc) mailOptions.cc = params.cc;
  if (params.bcc) mailOptions.bcc = params.bcc;
  if (params.html) mailOptions.html = params.html;
  if (params.attachmentPaths?.length) {
    mailOptions.attachments = params.attachmentPaths.map((p) => ({ path: p }));
  }

  const opts = params as SendOptions;
  if (opts.inReplyTo) mailOptions.inReplyTo = opts.inReplyTo;
  if (opts.references) {
    // mailparser hands back References as an array. Interpolating it into a
    // string produced a comma-separated list, which is not a valid References
    // header and broke threading from the third message onwards.
    mailOptions.references = Array.isArray(opts.references)
      ? [...opts.references]
      : opts.references;
  }
  if (opts.headers) mailOptions.headers = opts.headers;

  return mailOptions;
}

export async function sendEmail(
  config: EmailConfig,
  params: SendParams | SendOptions,
): Promise<SentMessage> {
  const mailOptions = buildMailOptions(config, params);

  // Compose first, then transmit the composed bytes. newline "windows" gives
  // CRLF line endings, which both SMTP and IMAP APPEND require.
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built: any = await composer.sendMail(mailOptions as any);
  const raw: Buffer = built?.message ?? Buffer.alloc(0);

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
    tls: config.smtp.tls,
  });

  const info: any = await transporter.sendMail({
    envelope: built?.envelope,
    raw,
  } as any);

  return {
    messageId: info?.messageId || built?.messageId || "",
    to: params.to,
    subject: params.subject,
    raw,
  };
}
