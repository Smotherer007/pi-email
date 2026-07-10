import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { EmailConfig } from "../src/types.ts";

let sendEmail: any;
let mockCreateTransport: any;
let mockSendMail: any;

const config: EmailConfig = {
  imap: {
    host: "imap.example.com",
    port: 993,
    tls: true,
    user: "sender@example.com",
    password: "secret",
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "sender@example.com",
    password: "secret",
  },
  fromName: "Sender",
};

before(async () => {
  mockSendMail = mock.fn(() => ({ messageId: "message-1" }));
  mockCreateTransport = mock.fn(() => ({ sendMail: mockSendMail }));

  mock.module("nodemailer", {
    exports: { default: { createTransport: mockCreateTransport } },
  });

  ({ sendEmail } = await import("../src/clients/smtp-client.ts"));
});

describe("sendEmail", () => {
  it("passes local attachment paths to nodemailer", async () => {
    mockSendMail.mock.resetCalls();

    await sendEmail(config, {
      to: "recipient@example.com",
      subject: "Hi",
      body: "Hello",
      attachmentPaths: ["/tmp/report.pdf", "notes.txt"],
    });

    assert.strictEqual(mockSendMail.mock.callCount(), 1);
    const mailArg = mockSendMail.mock.calls[0].arguments[0];
    assert.strictEqual(mailArg.from, '"Sender" <sender@example.com>');
    assert.strictEqual(mailArg.to, "recipient@example.com");
    assert.strictEqual(mailArg.subject, "Hi");
    assert.strictEqual(mailArg.text, "Hello");
    assert.strictEqual(mailArg.disableUrlAccess, true);
    assert.deepStrictEqual(mailArg.attachments, [
      { path: "/tmp/report.pdf" },
      { path: "notes.txt" },
    ]);
  });

  it("omits attachments when none are provided", async () => {
    mockSendMail.mock.resetCalls();

    await sendEmail(config, {
      to: "recipient@example.com",
      subject: "Hi",
      body: "Hello",
    });

    const mailArg = mockSendMail.mock.calls[0].arguments[0];
    assert.strictEqual(mailArg.attachments, undefined);
  });

  it("rejects URL and data URI attachments", async () => {
    mockSendMail.mock.resetCalls();

    await assert.rejects(
      () =>
        sendEmail(config, {
          to: "recipient@example.com",
          subject: "Hi",
          body: "Hello",
          attachmentPaths: ["https://example.com/report.pdf"],
        }),
      /Only local attachment paths are supported/,
    );

    await assert.rejects(
      () =>
        sendEmail(config, {
          to: "recipient@example.com",
          subject: "Hi",
          body: "Hello",
          attachmentPaths: ["data:text/plain;base64,SGVsbG8="],
        }),
      /Only local attachment paths are supported/,
    );

    assert.strictEqual(mockSendMail.mock.callCount(), 0);
  });
});
