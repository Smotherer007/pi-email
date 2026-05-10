import { describe, it, expect } from "vitest";
import {
  formatMailboxList,
  formatHeaderList,
  formatEmailBody,
  formatSearchResults,
  formatSendResult,
  formatNotConfiguredStatus,
  formatConfiguredStatus,
} from "../src/formatting/formatters";
import type {
  EmailBody,
  EmailHeader,
  MailboxInfo,
  SendResult,
} from "../src/types";

// ── formatMailboxList ───────────────────────────────────────────────────────

describe("formatMailboxList", () => {
  it("returns 'no mailboxes' for empty list", () => {
    expect(formatMailboxList([])).toBe("No mailboxes found.");
  });

  it("formats single selectable mailbox", () => {
    const boxes: MailboxInfo[] = [
      { name: "INBOX", selectable: true, children: [] },
    ];
    expect(formatMailboxList(boxes)).toBe(
      "Available mailboxes:\n[ ] INBOX",
    );
  });

  it("marks non-selectable boxes with [>]", () => {
    const boxes: MailboxInfo[] = [
      { name: "Archive", selectable: false, children: [] },
    ];
    const result = formatMailboxList(boxes);
    expect(result).toContain("[>] Archive/");
  });

  it("formats nested mailboxes with indentation", () => {
    const boxes: MailboxInfo[] = [
      {
        name: "INBOX",
        selectable: true,
        children: [
          { name: "Subfolder", selectable: true, children: [] },
        ],
      },
    ];
    const result = formatMailboxList(boxes);
    expect(result).toContain("[ ] INBOX");
    expect(result).toContain("  [ ] Subfolder");
  });

  it("formats deeply nested structure", () => {
    const boxes: MailboxInfo[] = [
      {
        name: "A",
        selectable: false,
        children: [
          {
            name: "B",
            selectable: true,
            children: [
              { name: "C", selectable: true, children: [] },
            ],
          },
        ],
      },
    ];
    const result = formatMailboxList(boxes);
    const lines = result.split("\n");
    expect(lines[0]).toBe("Available mailboxes:");
    expect(lines[1]).toBe("[>] A/");
    expect(lines[2]).toBe("  [ ] B");
    expect(lines[3]).toBe("    [ ] C");
  });
});

// ── formatHeaderList ────────────────────────────────────────────────────────

describe("formatHeaderList", () => {
  it("returns empty message for no headers", () => {
    const result = formatHeaderList([], "INBOX", 0);
    expect(result).toBe('Mailbox "INBOX" is empty.');
  });

  it("shows correct count header", () => {
    const headers: EmailHeader[] = [
      {
        uid: 10,
        from: "alice@example.com",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Hello",
        date: "2025-01-01T00:00:00.000Z",
        flags: ["\\Seen"],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 100);
    expect(result).toContain(
      'Mailbox "INBOX" -- showing 1 of 100 messages:',
    );
  });

  it("marks read emails with [read]", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Test",
        date: "2025-01-01T00:00:00.000Z",
        flags: ["\\Seen"],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("[read]");
  });

  it("marks unread emails with [unread]", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Test",
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("[unread]");
  });

  it("shows (no subject) for empty subject", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "",
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("(no subject)");
  });

  it("truncates long subjects at 70 characters", () => {
    const longSubject = "A".repeat(100);
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: longSubject,
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("A".repeat(70) + "...");
    expect(result).not.toContain(longSubject);
  });

  it("extracts name from From address", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Display Name <email@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Test",
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("Display Name");
    expect(result).not.toContain("<email@example.com>");
  });

  it("handles unknown date gracefully", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Test",
        date: "",
        flags: [],
      },
    ];
    const result = formatHeaderList(headers, "INBOX", 1);
    expect(result).toContain("unknown");
  });
});

// ── formatEmailBody ─────────────────────────────────────────────────────────

describe("formatEmailBody", () => {
  const baseEmail: EmailBody = {
    uid: 42,
    from: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>",
    cc: "",
    subject: "Hello World",
    date: "2025-01-01T00:00:00.000Z",
    text: "This is the body.",
    attachments: [],
  };

  it("shows UID, From, To, Date, Subject", () => {
    const result = formatEmailBody(baseEmail, []);
    expect(result).toContain("Email UID: 42");
    expect(result).toContain("From: Alice <alice@example.com>");
    expect(result).toContain("To: Bob <bob@example.com>");
    expect(result).toContain("Date: 2025-01-01T00:00:00.000Z");
    expect(result).toContain("Subject: Hello World");
  });

  it("shows CC when present", () => {
    const withCC = { ...baseEmail, cc: "Carol <carol@example.com>" };
    const result = formatEmailBody(withCC, []);
    expect(result).toContain("CC: Carol <carol@example.com>");
  });

  it("does not show CC when empty", () => {
    const result = formatEmailBody(baseEmail, []);
    expect(result).not.toContain("CC:");
  });

  it("shows attachments section when present", () => {
    const withAtt = {
      ...baseEmail,
      attachments: [
        { filename: "doc.pdf", contentType: "application/pdf", sizeKb: 100 },
      ],
    };
    const result = formatEmailBody(withAtt, []);
    expect(result).toContain("Attachments:");
    expect(result).toContain("[file] doc.pdf (application/pdf, 100KB)");
  });

  it("shows multiple attachments", () => {
    const withAtts = {
      ...baseEmail,
      attachments: [
        { filename: "a.pdf", contentType: "application/pdf", sizeKb: 10 },
        { filename: "b.png", contentType: "image/png", sizeKb: 5 },
      ],
    };
    const result = formatEmailBody(withAtts, []);
    expect(result).toContain("[file] a.pdf");
    expect(result).toContain("[file] b.png");
  });

  it("shows saved files path section", () => {
    const result = formatEmailBody(baseEmail, [
      "/tmp/doc.pdf",
      "/tmp/img.png",
    ]);
    expect(result).toContain("Attachments saved to:");
    expect(result).toContain("  /tmp/doc.pdf");
    expect(result).toContain("  /tmp/img.png");
  });

  it("truncates body at 8000 characters", () => {
    const longText = "x".repeat(10000);
    const longEmail = { ...baseEmail, text: longText };
    const result = formatEmailBody(longEmail, []);
    expect(result).toContain("x".repeat(8000));
    expect(result).toContain("[... email truncated ...]");
    expect(result).not.toContain("x".repeat(8001));
  });

  it("handles empty body by showing empty text", () => {
    const emptyEmail = { ...baseEmail, text: "" };
    const result = formatEmailBody(emptyEmail, []);
    expect(result).toContain("--- Body ---");
  });

  describe("PDF attachments", () => {
    it("shows PDF section for single PDF", () => {
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "invoice.pdf", text: "Invoice #123\nTotal: 100 EUR" }],
      };
      const result = formatEmailBody(email, []);
      expect(result).toContain("--- PDF: invoice.pdf ---");
      expect(result).toContain("Invoice #123");
      expect(result).toContain("Total: 100 EUR");
    });

    it("shows multiple PDFs in order", () => {
      const email = {
        ...baseEmail,
        pdfTexts: [
          { filename: "a.pdf", text: "Content A" },
          { filename: "b.pdf", text: "Content B" },
        ],
      };
      const result = formatEmailBody(email, []);
      const aPos = result.indexOf("--- PDF: a.pdf ---");
      const bPos = result.indexOf("--- PDF: b.pdf ---");
      expect(aPos).toBeLessThan(bPos);
    });

    it("shows (no text extracted) for empty PDF", () => {
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "empty.pdf", text: "" }],
      };
      const result = formatEmailBody(email, []);
      expect(result).toContain("(no text extracted)");
    });

    it("truncates PDF text at 5000 characters", () => {
      const pdfText = "y".repeat(6000);
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "big.pdf", text: pdfText }],
      };
      const result = formatEmailBody(email, []);
      expect(result).toContain("y".repeat(5000));
      expect(result).toContain("[... PDF truncated ...]");
    });

    it("does not show PDF section when pdfTexts is undefined", () => {
      const result = formatEmailBody(baseEmail, []);
      expect(result).not.toContain("--- PDF:");
    });

    it("does not show PDF section when pdfTexts is empty array", () => {
      const email = { ...baseEmail, pdfTexts: [] };
      const result = formatEmailBody(email, []);
      expect(result).not.toContain("--- PDF:");
    });
  });
});

// ── formatSearchResults ─────────────────────────────────────────────────────

describe("formatSearchResults", () => {
  it("shows no results message for empty list", () => {
    expect(formatSearchResults([], 0)).toBe(
      "No emails matching your search criteria.",
    );
  });

  it("shows correct total and shown counts", () => {
    const headers: EmailHeader[] = [
      {
        uid: 5,
        from: "Alice <alice@example.com>",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Test",
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatSearchResults(headers, 25);
    expect(result).toContain("Search results (25 total, showing 1):");
  });

  it("shows UID, from, subject, date for each result", () => {
    const headers: EmailHeader[] = [
      {
        uid: 99,
        from: "Alice <alice@example.com>",
        to: "",
        cc: "",
        bcc: "",
        subject: "Hello",
        date: "2025-06-15T12:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatSearchResults(headers, 1);
    expect(result).toContain("[UID:99]");
    expect(result).toContain("Alice");
    expect(result).toContain('"Hello"');
  });

  it("shows (no subject) for empty subject in search", () => {
    const headers: EmailHeader[] = [
      {
        uid: 1,
        from: "Alice <alice@example.com>",
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        date: "2025-01-01T00:00:00.000Z",
        flags: [],
      },
    ];
    const result = formatSearchResults(headers, 1);
    expect(result).toContain("(no subject)");
  });
});

// ── formatSendResult ────────────────────────────────────────────────────────

describe("formatSendResult", () => {
  it("shows success message with details", () => {
    const result: SendResult = {
      messageId: "<abc123@example.com>",
      to: "bob@example.com",
      subject: "Test email",
    };
    const text = formatSendResult(result);
    expect(text).toContain("Email sent successfully.");
    expect(text).toContain("Message-ID: <abc123@example.com>");
    expect(text).toContain("To: bob@example.com");
    expect(text).toContain("Subject: Test email");
  });
});

// ── formatNotConfiguredStatus ────────────────────────────────────────────────

describe("formatNotConfiguredStatus", () => {
  it("returns unconfigured message", () => {
    const result = formatNotConfiguredStatus();
    expect(result).toContain("Email not configured");
    expect(result).toContain("email_setup");
  });
});

// ── formatConfiguredStatus ──────────────────────────────────────────────────

describe("formatConfiguredStatus", () => {
  it("shows IMAP and SMTP config", () => {
    const result = formatConfiguredStatus(
      "imap.example.com",
      993,
      true,
      "user@example.com",
      "smtp.example.com",
      587,
      false,
      "user@example.com",
    );
    expect(result).toContain("Email configured");
    expect(result).toContain("IMAP: user@example.com@imap.example.com:993 (TLS: true)");
    expect(result).toContain("SMTP: user@example.com@smtp.example.com:587 (Secure: false)");
  });

  it("does not show from name line when missing", () => {
    const result = formatConfiguredStatus(
      "imap.example.com",
      993,
      true,
      "user@example.com",
      "smtp.example.com",
      587,
      false,
      "user@example.com",
      undefined,
    );
    expect(result).not.toContain("From name:");
  });

  it("shows from name when provided", () => {
    const result = formatConfiguredStatus(
      "imap.example.com",
      993,
      true,
      "user@example.com",
      "smtp.example.com",
      587,
      false,
      "user@example.com",
      "John Doe",
    );
    expect(result).toContain("From name: John Doe");
  });
});
