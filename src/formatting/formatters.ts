/**
 * Output formatters.
 *
 * Pure functions that transform domain data into display strings.
 * No emojis, no side effects.
 */

import type { EmailBody, EmailHeader, MailboxInfo, SendResult } from "../types";

// ── Mailbox list ────────────────────────────────────────────────────────────

export function formatMailboxList(mailboxes: ReadonlyArray<MailboxInfo>): string {
  if (mailboxes.length === 0) {
    return "No mailboxes found.";
  }

  const lines: string[] = [];
  function walk(items: ReadonlyArray<MailboxInfo>, indent: string): void {
    for (const box of items) {
      const marker = box.selectable ? "[ ]" : "[>]";
      const suffix = box.selectable ? "" : "/";
      lines.push(`${indent}${marker} ${box.name}${suffix}`);
      if (box.children.length > 0) {
        walk(box.children, indent + "  ");
      }
    }
  }

  walk(mailboxes, "");
  return "Available mailboxes:\n" + lines.join("\n");
}

// ── Email headers list ──────────────────────────────────────────────────────

export function formatHeaderList(
  headers: ReadonlyArray<EmailHeader>,
  mailbox: string,
  total: number,
): string {
  if (headers.length === 0) {
    return `Mailbox "${mailbox}" is empty.`;
  }

  const lines: string[] = [
    `Mailbox "${mailbox}" -- showing ${headers.length} of ${total} messages:`,
    "",
  ];

  for (const e of headers) {
    const flag = e.flags.includes("\\Seen") ? "[read]" : "[unread]";
    const subject = e.subject || "(no subject)";
    const from = e.from.split("<")[0].trim() || e.from;
    const date = e.date ? new Date(e.date).toLocaleString() : "unknown";
    const shortSubject =
      subject.length > 70 ? subject.substring(0, 70) + "..." : subject;
    lines.push(
      `${flag} [UID:${e.uid}] ${from} -- "${shortSubject}" (${date})`,
    );
  }

  return lines.join("\n");
}

// ── Single email body ───────────────────────────────────────────────────────

export function formatEmailBody(
  email: EmailBody,
  savedFiles: ReadonlyArray<string>,
): string {
  const parts: string[] = [
    `Email UID: ${email.uid}`,
    `From: ${email.from}`,
    `To: ${email.to}`,
  ];

  if (email.cc) {
    parts.push(`CC: ${email.cc}`);
  }

  parts.push(
    `Date: ${email.date}`,
    `Subject: ${email.subject}`,
  );

  if (email.attachments.length > 0) {
    parts.push("");
    parts.push("Attachments:");
    for (const att of email.attachments) {
      parts.push(
        `  [file] ${att.filename} (${att.contentType}, ${att.sizeKb}KB)`,
      );
    }
  }

  if (savedFiles.length > 0) {
    parts.push("");
    parts.push("Attachments saved to:");
    for (const f of savedFiles) {
      parts.push(`  ${f}`);
    }
  }

  if (email.pdfTexts && email.pdfTexts.length > 0) {
    for (const pdf of email.pdfTexts) {
      parts.push("");
      parts.push(`--- PDF: ${pdf.filename} ---`);
      const pdfBody =
        pdf.text.length > 5000
          ? pdf.text.substring(0, 5000) + "\n\n[... PDF truncated ...]"
          : pdf.text;
      parts.push(pdfBody || "(no text extracted)");
    }
  }

  const body =
    email.text.length > 8000
      ? email.text.substring(0, 8000) + "\n\n[... email truncated ...]"
      : email.text;

  parts.push("");
  parts.push("--- Body ---");
  parts.push(body);

  return parts.join("\n");
}

// ── Search results ──────────────────────────────────────────────────────────

export function formatSearchResults(
  headers: ReadonlyArray<EmailHeader>,
  totalResults: number,
): string {
  if (headers.length === 0) {
    return "No emails matching your search criteria.";
  }

  const lines: string[] = [
    `Search results (${totalResults} total, showing ${headers.length}):`,
    "",
  ];

  for (const e of headers) {
    const subject = e.subject || "(no subject)";
    const from = e.from.split("<")[0].trim() || e.from;
    const date = e.date ? new Date(e.date).toLocaleString() : "unknown";
    const shortSubject =
      subject.length > 70 ? subject.substring(0, 70) + "..." : subject;
    lines.push(
      `[UID:${e.uid}] ${from} -- "${shortSubject}" (${date})`,
    );
  }

  return lines.join("\n");
}

// ── Send result ─────────────────────────────────────────────────────────────

export function formatSendResult(result: SendResult): string {
  return [
    "Email sent successfully.",
    `Message-ID: ${result.messageId}`,
    `To: ${result.to}`,
    `Subject: ${result.subject}`,
  ].join("\n");
}

// ── Status ──────────────────────────────────────────────────────────────────

export function formatNotConfiguredStatus(): string {
  return "Email not configured. Use the email_setup tool to configure your account.";
}

export function formatConfiguredStatus(
  imapHost: string,
  imapPort: number,
  imapTls: boolean,
  imapUser: string,
  smtpHost: string,
  smtpPort: number,
  smtpSecure: boolean,
  smtpUser: string,
  fromName?: string,
): string {
  const lines: string[] = [
    "Email configured",
    `IMAP: ${imapUser}@${imapHost}:${imapPort} (TLS: ${imapTls})`,
    `SMTP: ${smtpUser}@${smtpHost}:${smtpPort} (Secure: ${smtpSecure})`,
  ];

  if (fromName) {
    lines.push(`From name: ${fromName}`);
  }

  return lines.join("\n");
}
