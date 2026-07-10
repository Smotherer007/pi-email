import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMailboxList,
  formatHeaderList,
  formatEmailBody,
  formatSearchResults,
  formatSendResult,
  formatNotConfiguredStatus,
  formatConfiguredStatus,
} from "../src/formatting/formatters.ts";
import type {
  EmailBody,
  EmailHeader,
  MailboxInfo,
  SendResult,
} from "../src/types.ts";

// formatMailboxList

describe("formatMailboxList", () => {
  it("returns 'no mailboxes' for empty list", () => {
    assert.strictEqual(formatMailboxList([]), "No mailboxes found.");
  });

  it("formats single selectable mailbox", () => {
    const boxes: MailboxInfo[] = [
      { name: "INBOX", selectable: true, children: [] },
    ];
    assert.strictEqual(formatMailboxList(boxes), "Available mailboxes:\n[ ] INBOX");
  });

  it("marks non-selectable boxes with [>]", () => {
    const boxes: MailboxInfo[] = [
      { name: "Archive", selectable: false, children: [] },
    ];
    const result = formatMailboxList(boxes);
    assert.ok(result.includes("[>] Archive/"));
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
    assert.ok(result.includes("[ ] INBOX"));
    assert.ok(result.includes("  [ ] Subfolder"));
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
    assert.strictEqual(lines[0], "Available mailboxes:");
    assert.strictEqual(lines[1], "[>] A/");
    assert.strictEqual(lines[2], "  [ ] B");
    assert.strictEqual(lines[3], "    [ ] C");
  });
});

// formatHeaderList

describe("formatHeaderList", () => {
  it("returns empty message for no headers", () => {
    const result = formatHeaderList([], "INBOX", 0);
    assert.strictEqual(result, 'Mailbox "INBOX" is empty.');
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
    assert.ok(result.includes('Mailbox "INBOX" -- showing 1 of 100 messages:'));
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
    assert.ok(result.includes("[read]"));
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
    assert.ok(result.includes("[unread]"));
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
    assert.ok(result.includes("(no subject)"));
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
    assert.ok(result.includes("A".repeat(70) + "..."));
    assert.ok(!result.includes(longSubject));
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
    assert.ok(result.includes("Display Name"));
    assert.ok(!result.includes("<email@example.com>"));
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
    assert.ok(result.includes("unknown"));
  });
});

// formatEmailBody

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
    assert.ok(result.includes("Email UID: 42"));
    assert.ok(result.includes("From: Alice <alice@example.com>"));
    assert.ok(result.includes("To: Bob <bob@example.com>"));
    assert.ok(result.includes("Date: 2025-01-01T00:00:00.000Z"));
    assert.ok(result.includes("Subject: Hello World"));
  });

  it("shows CC when present", () => {
    const withCC = { ...baseEmail, cc: "Carol <carol@example.com>" };
    const result = formatEmailBody(withCC, []);
    assert.ok(result.includes("CC: Carol <carol@example.com>"));
  });

  it("does not show CC when empty", () => {
    const result = formatEmailBody(baseEmail, []);
    assert.ok(!result.includes("CC:"));
  });

  it("shows attachments section when present", () => {
    const withAtt = {
      ...baseEmail,
      attachments: [
        { filename: "doc.pdf", contentType: "application/pdf", sizeKb: 100 },
      ],
    };
    const result = formatEmailBody(withAtt, []);
    assert.ok(result.includes("Attachments:"));
    assert.ok(result.includes("[file] doc.pdf (application/pdf, 100KB)"));
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
    assert.ok(result.includes("[file] a.pdf"));
    assert.ok(result.includes("[file] b.png"));
  });

  it("shows saved files path section", () => {
    const result = formatEmailBody(baseEmail, [
      "/tmp/doc.pdf",
      "/tmp/img.png",
    ]);
    assert.ok(result.includes("Attachments saved to:"));
    assert.ok(result.includes("  /tmp/doc.pdf"));
    assert.ok(result.includes("  /tmp/img.png"));
  });

  it("truncates body at 8000 characters", () => {
    const longText = "x".repeat(10000);
    const longEmail = { ...baseEmail, text: longText };
    const result = formatEmailBody(longEmail, []);
    assert.ok(result.includes("x".repeat(8000)));
    assert.ok(result.includes("[... email truncated ...]"));
    assert.ok(!result.includes("x".repeat(8001)));
  });

  it("handles empty body by showing empty text", () => {
    const emptyEmail = { ...baseEmail, text: "" };
    const result = formatEmailBody(emptyEmail, []);
    assert.ok(result.includes("--- Body ---"));
  });

  describe("PDF attachments", () => {
    it("shows PDF section for single PDF", () => {
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "invoice.pdf", text: "Invoice #123\nTotal: 100 EUR" }],
      };
      const result = formatEmailBody(email, []);
      assert.ok(result.includes("--- PDF: invoice.pdf ---"));
      assert.ok(result.includes("Invoice #123"));
      assert.ok(result.includes("Total: 100 EUR"));
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
      assert.ok(aPos < bPos);
    });

    it("shows (no text extracted) for empty PDF", () => {
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "empty.pdf", text: "" }],
      };
      const result = formatEmailBody(email, []);
      assert.ok(result.includes("(no text extracted)"));
    });

    it("truncates PDF text at 5000 characters", () => {
      const pdfText = "y".repeat(6000);
      const email = {
        ...baseEmail,
        pdfTexts: [{ filename: "big.pdf", text: pdfText }],
      };
      const result = formatEmailBody(email, []);
      assert.ok(result.includes("y".repeat(5000)));
      assert.ok(result.includes("[... PDF truncated ...]"));
    });

    it("does not show PDF section when pdfTexts is undefined", () => {
      const result = formatEmailBody(baseEmail, []);
      assert.ok(!result.includes("--- PDF:"));
    });

    it("does not show PDF section when pdfTexts is empty array", () => {
      const email = { ...baseEmail, pdfTexts: [] };
      const result = formatEmailBody(email, []);
      assert.ok(!result.includes("--- PDF:"));
    });
  });
});

// formatSearchResults

describe("formatSearchResults", () => {
  it("shows no results message for empty list", () => {
    assert.strictEqual(
      formatSearchResults([], 0),
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
    assert.ok(result.includes("Search results (25 total, showing 1):"));
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
    assert.ok(result.includes("[UID:99]"));
    assert.ok(result.includes("Alice"));
    assert.ok(result.includes('"Hello"'));
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
    assert.ok(result.includes("(no subject)"));
  });
});

// formatSendResult

describe("formatSendResult", () => {
  it("shows success message with details", () => {
    const result: SendResult = {
      messageId: "<abc123@example.com>",
      to: "bob@example.com",
      subject: "Test email",
    };
    const text = formatSendResult(result);
    assert.ok(text.includes("Email sent successfully."));
    assert.ok(text.includes("Message-ID: <abc123@example.com>"));
    assert.ok(text.includes("To: bob@example.com"));
    assert.ok(text.includes("Subject: Test email"));
  });
});

// formatNotConfiguredStatus

describe("formatNotConfiguredStatus", () => {
  it("returns unconfigured message", () => {
    const result = formatNotConfiguredStatus();
    assert.ok(result.includes("Email not configured"));
    assert.ok(result.includes("email_setup"));
  });
});

// formatConfiguredStatus

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
    assert.ok(result.includes("Email configured"));
    assert.ok(result.includes("IMAP: user@example.com@imap.example.com:993 (TLS: true)"));
    assert.ok(result.includes("SMTP: user@example.com@smtp.example.com:587 (Secure: false)"));
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
    assert.ok(!result.includes("From name:"));
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
    assert.ok(result.includes("From name: John Doe"));
  });
});
