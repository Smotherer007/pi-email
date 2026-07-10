import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailReplyTool: any;
let mockReadEmail: any;
let mockSendEmail: any;

function mockOriginalEmail(overrides: any = {}) {
  return {
    parsed: {
      messageId: "<abc123@mail.test.com>",
      from: { text: "Alice <alice@example.com>", value: [{ address: "alice@example.com" }] },
      to: { text: "Me <me@test.com>", value: [{ address: "me@test.com" }] },
      cc: { text: "", value: [] },
      subject: "Hello World",
      date: new Date("2025-06-15T10:00:00Z"),
      text: "Hi there!\n\nHow are you?",
      ...overrides,
    },
    savedFiles: [],
  };
}

let readEmailImpl = () => mockOriginalEmail();

before(async () => {
  mockReadEmail = mock.fn(() => readEmailImpl());
  mockSendEmail = mock.fn(() => ({
    messageId: "<reply-xyz@mail.test.com>",
    to: "alice@example.com",
    subject: "Re: Hello World",
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

  ({ EmailReplyTool } = await import("../src/tools/email-reply.ts"));
});

describe("EmailReplyTool", () => {
  it("has correct tool name", () => {
    assert.strictEqual(EmailReplyTool.name, "email_reply");
  });

  it("replies to the original sender", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    const result = await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("Reply sent successfully"));

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(callArgs.to, "alice@example.com");
    assert.strictEqual(callArgs.subject, "Re: Hello World");
  });

  it("includes In-Reply-To and References headers", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(callArgs.customHeaders.inReplyTo, "<abc123@mail.test.com>");
    assert.strictEqual(callArgs.customHeaders.references, "<abc123@mail.test.com>");
  });

  it("quotes the original message by default", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.body.includes("My reply"));
    assert.ok(callArgs.body.includes("--- Original message ---"));
    assert.ok(callArgs.body.includes("From: Alice <alice@example.com>"));
    assert.ok(callArgs.body.includes("> Hi there!"));
  });

  it("does not quote when quoteOriginal is false", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply", quoteOriginal: false },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(callArgs.body, "My reply");
    assert.ok(!callArgs.body.includes("--- Original message ---"));
  });

  it("includes CC recipients when replyAll is true", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        to: {
          text: "Me <me@test.com>, Bob <bob@test.com>",
          value: [{ address: "me@test.com" }, { address: "bob@test.com" }],
        },
        cc: {
          text: "Carol <carol@test.com>",
          value: [{ address: "carol@test.com" }],
        },
      });
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Hi all", replyAll: true },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(callArgs.cc.includes("bob@test.com"));
    assert.ok(callArgs.cc.includes("carol@test.com"));
  });

  it("does not include sender in replyAll CC", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        from: { text: "Alice <alice@example.com>", value: [{ address: "alice@example.com" }] },
        to: {
          text: "Alice <alice@example.com>, Me <me@test.com>",
          value: [{ address: "alice@example.com" }, { address: "me@test.com" }],
        },
      });
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Hi", replyAll: true },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.ok(!callArgs.cc.includes("alice@example.com"));
  });

  it("handles missing subject gracefully", async () => {
    readEmailImpl = () => mockOriginalEmail({ subject: "" });
    mockSendEmail.mock.resetCalls();

    const result = await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Ok" },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("Reply sent successfully"));
  });

  it("uses existing references chain when present", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        messageId: "<msg3@test.com>",
        references: "<msg1@test.com> <msg2@test.com>",
      });
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Reply" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(
      callArgs.customHeaders.references,
      "<msg1@test.com> <msg2@test.com> <msg3@test.com>",
    );
  });

  it("sends HTML reply when provided", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockSendEmail.mock.resetCalls();

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Text reply", html: "<p>HTML reply</p>" },
      new AbortController().signal,
    );

    const callArgs = mockSendEmail.mock.calls[0].arguments[1];
    assert.strictEqual(callArgs.html, "<p>HTML reply</p>");
  });
});
