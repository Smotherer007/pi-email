/**
 * Data types for the pi Email Client extension.
 *
 * All domain data is represented as plain immutable-shaped interfaces.
 * No behavior, no classes, no inheritance -- just data.
 */

// Configuration

export interface ImapConfig {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly user: string;
  readonly password: string;
  /**
   * Validate the IMAP server's TLS certificate. Defaults to true.
   * Only set to false for local bridges (e.g. ProtonMail Bridge on 127.0.0.1)
   * where the certificate is self-signed.
   */
  readonly rejectUnauthorized?: boolean;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly tls?: {
    rejectUnauthorized: boolean;
  };
}

export interface EmailConfig {
  readonly imap: ImapConfig;
  readonly smtp: SmtpConfig;
  readonly fromName?: string;
  /**
   * Store a copy of every outgoing message in the Sent mailbox via IMAP APPEND.
   * Defaults to true, except for providers that already do this server-side
   * (Gmail), where it would create duplicates.
   */
  readonly appendToSent?: boolean;
  /** Explicit Sent mailbox name. When omitted it is auto-detected. */
  readonly sentMailbox?: string;
}

export interface EmailProfiles {
  readonly profiles: Record<string, EmailConfig>;
  readonly activeProfile: string | null;
}

// Domain

export interface EmailHeader {
  readonly uid: number;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly subject: string;
  readonly date: string;
  readonly flags: ReadonlyArray<string>;
}

export interface EmailBody {
  readonly uid: number;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly subject: string;
  readonly date: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<AttachmentInfo>;
  readonly pdfTexts?: ReadonlyArray<PdfContent>;
}

export interface PdfContent {
  readonly filename: string;
  readonly text: string;
}

export interface AttachmentInfo {
  readonly filename: string;
  readonly contentType: string;
  readonly sizeKb: number;
}

export interface SendResult {
  readonly messageId: string;
  readonly to: string;
  readonly subject: string;
}

/** Where the Sent-folder copy of an outgoing message ended up. */
export interface SentCopyStatus {
  readonly status: "saved" | "skipped" | "failed";
  readonly mailbox?: string;
  readonly reason?: string;
}

export interface MailboxInfo {
  readonly name: string;
  readonly selectable: boolean;
  readonly children: ReadonlyArray<MailboxInfo>;
  /** Full IMAP path including parent folders and delimiter. */
  readonly path?: string;
  /** Raw IMAP attributes, e.g. "\\Sent", "\\Noselect", "\\HasChildren". */
  readonly attributes?: ReadonlyArray<string>;
}

// Operation errors

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email not configured. Use the email_setup tool first.");
    this.name = "EmailNotConfiguredError";
  }
}

/** Thrown when a UID does not exist in the given mailbox. */
export class EmailNotFoundError extends Error {
  constructor(uid: number, mailbox: string) {
    super(`No email with UID ${uid} found in "${mailbox}".`);
    this.name = "EmailNotFoundError";
  }
}

/** Thrown when an attachment filename would escape the download directory. */
export class UnsafeAttachmentPathError extends Error {
  constructor(filename: string) {
    super(`Refusing to save attachment with unsafe filename: ${filename}`);
    this.name = "UnsafeAttachmentPathError";
  }
}

// Tool parameter types

export interface SetupParams {
  name: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUser: string;
  imapPassword: string;
  imapRejectUnauthorized?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpRejectUnauthorized?: boolean;
  fromName?: string;
  appendToSent?: boolean;
  sentMailbox?: string;
}

export interface FetchParams {
  profile?: string;
  mailbox?: string;
  limit?: number;
  unseen?: boolean;
}

export interface ReadParams {
  profile?: string;
  uid: number;
  mailbox?: string;
  downloadDir?: string;
}

export interface SearchParams {
  profile?: string;
  mailbox?: string;
  from?: string;
  subject?: string;
  body?: string;
  since?: string;
  before?: string;
  unseen?: boolean;
  limit?: number;
}

export interface SendParams {
  profile?: string;
  /** Sender email address; overrides the configured account when the SMTP provider allows it. */
  from?: string;
  /** Sender display name; overrides the configured fromName. */
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  html?: string;
  attachmentPaths?: ReadonlyArray<string>;
}

export interface DeleteParams {
  profile?: string;
  uid: number;
  mailbox?: string;
}

export interface MoveParams {
  profile?: string;
  uid: number;
  destination: string;
  source?: string;
}
