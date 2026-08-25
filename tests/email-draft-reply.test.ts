import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailDraftReplyTool: any;
let mockReadEmail: any;
let mockAppendDraftMessage: any;

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
  mockAppendDraftMessage = mock.fn(() => Promise.resolve(undefined));

  mock.module("../src/clients/imap-client.ts", {
    exports: { readEmail: mockReadEmail, appendDraftMessage: mockAppendDraftMessage },
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

  ({ EmailDraftReplyTool } = await import("../src/tools/email-draft-reply.ts"));
});

describe("EmailDraftReplyTool", () => {
  it("has correct tool name", () => {
    assert.strictEqual(EmailDraftReplyTool.name, "email_draft_reply");
  });

  it("appends a draft instead of sending", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockAppendDraftMessage.mock.resetCalls();

    const result = await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );

    assert.ok(result.content[0].text.includes("not sent"));
    assert.strictEqual(mockAppendDraftMessage.mock.callCount(), 1);

    const args = mockAppendDraftMessage.mock.calls[0].arguments;
    assert.strictEqual(args[1], "Drafts");

    const eml = args[2];
    assert.ok(eml.includes("X-Unsent: 1"));
    assert.ok(eml.includes("To: alice@example.com"));
    assert.ok(eml.includes("Subject: Re: Hello World"));
    assert.ok(eml.includes("In-Reply-To: <abc123@mail.test.com>"));
    assert.ok(eml.includes("References: <abc123@mail.test.com>"));
    assert.ok(eml.includes("Thanks!"));
  });

  it("uses a custom draft mailbox", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockAppendDraftMessage.mock.resetCalls();

    await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!", draftMailbox: "My Drafts" },
      new AbortController().signal,
    );

    assert.strictEqual(mockAppendDraftMessage.mock.calls[0].arguments[1], "My Drafts");
  });

  it("quotes the original message by default", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockAppendDraftMessage.mock.resetCalls();

    await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply" },
      new AbortController().signal,
    );

    const eml = mockAppendDraftMessage.mock.calls[0].arguments[2];
    assert.ok(eml.includes("My reply"));
    assert.ok(eml.includes("--- Original message ---"));
    assert.ok(eml.includes("> Hi there!"));
  });

  it("does not quote when quoteOriginal is false", async () => {
    readEmailImpl = () => mockOriginalEmail();
    mockAppendDraftMessage.mock.resetCalls();

    await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply", quoteOriginal: false },
      new AbortController().signal,
    );

    const eml = mockAppendDraftMessage.mock.calls[0].arguments[2];
    assert.ok(!eml.includes("--- Original message ---"));
  });

  it("includes CC recipients when replyAll is true", async () => {
    readEmailImpl = () =>
      mockOriginalEmail({
        to: {
          text: "Me <me@test.com>, Bob <bob@test.com>",
          value: [{ address: "me@test.com" }, { address: "bob@test.com" }],
        },
      });
    mockAppendDraftMessage.mock.resetCalls();

    await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "Hi all", replyAll: true },
      new AbortController().signal,
    );

    const eml = mockAppendDraftMessage.mock.calls[0].arguments[2];
    assert.ok(eml.includes("Cc: bob@test.com"));
  });

  it("does not stack Re: on an already-prefixed subject", async () => {
    readEmailImpl = () => mockOriginalEmail({ subject: "Re: Hello World" });
    mockAppendDraftMessage.mock.resetCalls();

    await EmailDraftReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );

    const eml = mockAppendDraftMessage.mock.calls[0].arguments[2];
    assert.ok(eml.includes("Subject: Re: Hello World"));
    assert.ok(!eml.includes("Subject: Re: Re:"));
  });
});
