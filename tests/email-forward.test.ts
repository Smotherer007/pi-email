import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailForwardTool: any;
let mockReadEmail: any;
let mockSendEmail: any;

function mockOriginalEmail(overrides: any = {}) {
  return {
    parsed: {
      from: { text: "Alice <alice@example.com>" },
      to: { text: "Me <me@test.com>" },
      cc: { text: "" },
      subject: "Important Report",
      date: new Date("2025-06-15T10:00:00Z"),
      text: "Please review the attached report.",
      attachments: [],
      ...overrides,
    },
    savedFiles: [],
  };
}

let readEmailImpl = () => mockOriginalEmail();

before(async () => {
  mockReadEmail = mock.fn(() => readEmailImpl());
  mockSendEmail = mock.fn(() => ({
    messageId: "<fwd-xyz@mail.test.com>",
    to: "bob@example.com",
    subject: "Fwd: Important Report",
  }));

  mock.module("../src/clients/imap-client.ts", {
    exports: { readEmail: mockReadEmail },
  });

  mock.module("../src/clients/smtp-client.ts", {
    exports: { sendEmail: mockSendEmail },
  });

  mock.module("../src/config.ts", {
    exports: {
      resolveConfig: mock.fn(() => ({
        imap: { host: "imap.test.com", port: 993, tls: true, user: "me@test.com", password: "pw" },
        smtp: { host: "smtp.test.com", port: 587, secure: false, user: "me@test.com", password: "pw" },
        fromName: "Test User",
      })),
    },
  });

  ({ EmailForwardTool } = await import("../src/tools/email-forward.ts"));
});

describe("EmailForwardTool", () => {
  it("has correct tool name", () => {
    assert.strictEqual(EmailForwardTool.name, "email_forward");
  });

  it("forwards to specified recipient", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("Email forwarded successfully"));

    assert.strictEqual(mockSendEmail.mock.callCount(), 1);
    const call = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(call.to, "bob@example.com");
    assert.strictEqual(call.subject, "Fwd: Important Report");
  });

  it("includes forwarding headers in body", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("---------- Forwarded message ----------"));
    assert.ok(callArgs.body.includes("From: Alice <alice@example.com>"));
    assert.ok(callArgs.body.includes("Subject: Important Report"));
    assert.ok(callArgs.body.includes("To: Me <me@test.com>"));
    assert.ok(callArgs.body.includes("Please review the attached report."));
  });

  it("includes optional comment above forwarding headers", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com", body: "FYI, please take a look." },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("FYI, please take a look."));
    const commentPos = callArgs.body.indexOf("FYI, please take a look.");
    const fwdPos = callArgs.body.indexOf("---------- Forwarded message ----------");
    assert.ok(commentPos < fwdPos);
  });

  it("includes CC line when original had CC", async () => {
    readEmailImpl = () => mockOriginalEmail({ cc: { text: "Carol <carol@test.com>" } });
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("CC: Carol <carol@test.com>"));
  });

  it("lists attachment names in body", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        attachments: [
          { filename: "report.pdf", contentType: "application/pdf" },
          { filename: "image.png", contentType: "image/png" },
        ],
      });
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("Attachments: report.pdf, image.png"));
  });

  it("handles unnamed attachments gracefully", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        attachments: [{ contentType: "application/octet-stream" }],
      });
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("Attachments: unnamed"));
  });

  it("supports CC and BCC", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com", cc: "eve@example.com", bcc: "boss@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(callArgs.cc, "eve@example.com");
    assert.strictEqual(callArgs.bcc, "boss@example.com");
  });

  it("handles missing subject gracefully", async () => {
    readEmailImpl = () => mockOriginalEmail({ subject: "" });
    mockSendEmail.mock.resetCalls();

    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("Email forwarded successfully"));
  });

  it("handles empty text body", async () => {
    readEmailImpl = () => mockOriginalEmail({ text: "" });
    mockSendEmail.mock.resetCalls();

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("(no text content)"));
  });

  it("reports attachment count in details", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        attachments: [
          { filename: "a.pdf" },
          { filename: "b.pdf" },
        ],
      });
    mockSendEmail.mock.resetCalls();

    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    assert.strictEqual(result.details.attachmentCount, 2);
  });
});
