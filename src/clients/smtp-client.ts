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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EmailConfig, SendParams, SendResult } from "../types.ts";
import { getAccessToken } from "../oauth/tokens.ts";

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

/**
 * Directories an attachment may be read from.
 *
 * An allowlist, not a denylist: the agent acts on the contents of untrusted
 * incoming mail, so a message that talks it into attaching a credential file
 * must not succeed. The earlier check knew only about the pi config directory,
 * which left ~/.ssh, ~/.aws and every .env in reach.
 *
 * The working directory and the temp locations are allowed because that is
 * where the agent produces files and where `email_read` with downloadDir lands
 * downloads before `email_send` forwards them. PI_EMAIL_ATTACH_ROOTS adds more,
 * separated by the platform path delimiter.
 */
function allowedAttachmentRoots(): string[] {
  const configured = (process.env.PI_EMAIL_ATTACH_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  // `/tmp` is listed apart from os.tmpdir() because on macOS they are different
  // places: tmpdir() is a per-user directory under /var/folders, while /tmp is
  // the symlink people actually write to.
  return [process.cwd(), os.tmpdir(), "/tmp", ...configured];
}

/** Resolve symlinks when the path exists; otherwise the plain absolute path. */
function resolveForComparison(target: string): string {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Whether `target` lies under `root`.
 *
 * Both the resolved and the plain absolute spelling of each side are compared:
 * a file that does not exist yet cannot be resolved, so `/tmp/x` stays `/tmp/x`
 * while an existing one becomes `/private/tmp/x` — same directory, two
 * spellings, and only the second one would match a realpath'd root.
 */
function withinRoot(target: string, root: string): boolean {
  const variants = (candidate: string) => [
    resolveForComparison(candidate),
    path.resolve(candidate),
  ];
  return variants(target).some((t) =>
    variants(root).some((r) => isInside(t, r)),
  );
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

  // Absolute rule, checked first: the credential store is never attachable, not
  // even when a configured root would otherwise cover it.
  if (withinRoot(attachmentPath, configDir())) {
    throw new Error(
      `Refusing to attach a file from the pi configuration directory: ${attachmentPath}`,
    );
  }

  const roots = allowedAttachmentRoots();
  if (!roots.some((root) => withinRoot(attachmentPath, root))) {
    throw new Error(
      `Refusing to attach a file outside the allowed directories (${[...new Set(roots)].join(", ")}): ${attachmentPath}. Widen with PI_EMAIL_ATTACH_ROOTS.`,
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

  assertSingleLine(params.from, "from");
  assertSingleLine(params.fromName, "fromName");
  assertSingleLine(params.to, "to");
  assertSingleLine(params.cc, "cc");
  assertSingleLine(params.bcc, "bcc");
  assertSingleLine(params.subject, "subject");

  const mailOptions: Record<string, unknown> = {
    // Object form so nodemailer does the quoting and RFC 2047 encoding.
    // The old template string broke on display names containing a quote.
    from: {
      name: params.fromName || config.fromName || config.smtp.user,
      address: params.from || config.smtp.user,
    },
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

export interface ComposedMessage {
  readonly raw: Buffer;
  readonly envelope: unknown;
  readonly messageId: string;
}

/**
 * Build the RFC 822 message for `params` without sending it.
 *
 * `keepBcc` keeps the Bcc header in the raw message. SMTP must not do that
 * (the envelope carries Bcc recipients), but Microsoft Graph takes its
 * recipients from the MIME headers, so a Graph send needs it.
 */
export async function composeMessage(
  config: EmailConfig,
  params: SendParams | SendOptions,
  options: { keepBcc?: boolean } = {},
): Promise<ComposedMessage> {
  const mailOptions = buildMailOptions(config, params);
  if (options.keepBcc) mailOptions.keepBcc = true;

  // newline "windows" gives CRLF line endings, which SMTP, IMAP APPEND and
  // Graph MIME uploads all expect.
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built: any = await composer.sendMail(mailOptions as any);
  return {
    raw: built?.message ?? Buffer.alloc(0),
    envelope: built?.envelope,
    messageId: built?.messageId || "",
  };
}

export async function sendEmail(
  config: EmailConfig,
  params: SendParams | SendOptions,
): Promise<SentMessage> {
  // Compose first, then transmit the composed bytes.
  const built = await composeMessage(config, params);
  const raw = built.raw;

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.oauth
      ? {
          type: "OAuth2",
          user: config.smtp.user,
          accessToken: await getAccessToken(config),
        }
      : {
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
