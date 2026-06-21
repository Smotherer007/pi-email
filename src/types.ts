/**
 * Data types for the pi Email Client extension.
 *
 * All domain data is represented as plain immutable-shaped interfaces.
 * No behavior, no classes, no inheritance -- just data.
 */

// ── Configuration ───────────────────────────────────────────────────────────

export interface ImapConfig {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly user: string;
  readonly password: string;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
}

export interface EmailConfig {
  readonly imap: ImapConfig;
  readonly smtp: SmtpConfig;
  readonly fromName?: string;
}

export interface EmailProfiles {
  readonly profiles: Record<string, EmailConfig>;
  readonly activeProfile: string | null;
}

// ── Domain ──────────────────────────────────────────────────────────────────

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

export interface MailboxInfo {
  readonly name: string;
  readonly selectable: boolean;
  readonly children: ReadonlyArray<MailboxInfo>;
}

// ── Operation errors ────────────────────────────────────────────────────────

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email not configured. Use the email_setup tool first.");
    this.name = "EmailNotConfiguredError";
  }
}

// ── Tool parameter types (for documentation symmetry with TypeBox schemas) ──

export interface SetupParams {
  name: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUser: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromName?: string;
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
