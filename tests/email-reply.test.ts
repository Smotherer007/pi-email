import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock IMAP client
vi.mock("../src/clients/imap-client", () => ({
  readEmail: vi.fn(),
}));

// Mock SMTP client
vi.mock("../src/clients/smtp-client", () => ({
  sendEmail: vi.fn(),
}));

// Mock config
vi.mock("../src/config", () => ({
  resolveConfig: vi.fn(() => ({
    imap: { host: "imap.test.com", port: 993, tls: true, user: "me@test.com", password: "pw" },
    smtp: { host: "smtp.test.com", port: 587, secure: false, user: "me@test.com", password: "pw" },
    fromName: "Test User",
  })),
}));

import { EmailReplyTool } from "../src/tools/email-reply";
import { readEmail } from "../src/clients/imap-client";
import { sendEmail } from "../src/clients/smtp-client";

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

describe("EmailReplyTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readEmail as any).mockResolvedValue(mockOriginalEmail());
    (sendEmail as any).mockResolvedValue({
      messageId: "<reply-xyz@mail.test.com>",
      to: "alice@example.com",
      subject: "Re: Hello World",
    });
  });

  it("has correct tool name", () => {
    expect(EmailReplyTool.name).toBe("email_reply");
  });

  it("replies to the original sender", async () => {
    const result = await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("Reply sent successfully");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Re: Hello World",
      }),
    );
  });

  it("includes In-Reply-To and References headers", async () => {
    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Thanks!" },
      new AbortController().signal,
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customHeaders: expect.objectContaining({
          inReplyTo: "<abc123@mail.test.com>",
          references: "<abc123@mail.test.com>",
        }),
      }),
    );
  });

  it("quotes the original message by default", async () => {
    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("My reply");
    expect(callArgs.body).toContain("--- Original message ---");
    expect(callArgs.body).toContain("From: Alice <alice@example.com>");
    expect(callArgs.body).toContain("> Hi there!");
  });

  it("does not quote when quoteOriginal is false", async () => {
    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "My reply", quoteOriginal: false },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toBe("My reply");
    expect(callArgs.body).not.toContain("--- Original message ---");
  });

  it("includes CC recipients when replyAll is true", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      to: { text: "Me <me@test.com>, Bob <bob@test.com>", value: [{ address: "me@test.com" }, { address: "bob@test.com" }] },
      cc: { text: "Carol <carol@test.com>", value: [{ address: "carol@test.com" }] },
    }));

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Hi all", replyAll: true },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.cc).toContain("bob@test.com");
    expect(callArgs.cc).toContain("carol@test.com");
  });

  it("does not include sender in replyAll CC", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      from: { text: "Alice <alice@example.com>", value: [{ address: "alice@example.com" }] },
      to: { text: "Alice <alice@example.com>, Me <me@test.com>", value: [{ address: "alice@example.com" }, { address: "me@test.com" }] },
    }));

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Hi", replyAll: true },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.cc).not.toContain("alice@example.com");
  });

  it("handles missing subject gracefully", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({ subject: "" }));

    const result = await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Ok" },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("Reply sent successfully");
  });

  it("uses existing references chain when present", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      messageId: "<msg3@test.com>",
      references: "<msg1@test.com> <msg2@test.com>",
    }));

    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Reply" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.customHeaders.references).toBe("<msg1@test.com> <msg2@test.com> <msg3@test.com>");
  });

  it("sends HTML reply when provided", async () => {
    await EmailReplyTool.execute(
      "call-1",
      { uid: 42, body: "Text reply", html: "<p>HTML reply</p>" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.html).toBe("<p>HTML reply</p>");
  });
});
