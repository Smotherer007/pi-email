import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let deliverEmail: any;
let savesSentCopyServerSide: any;
let mockSendEmail: any;
let mockAppendToSent: any;

function baseConfig(overrides: any = {}) {
  return {
    imap: { host: "imap.test.com", port: 993, tls: true, user: "me@test.com", password: "pw" },
    smtp: { host: "smtp.test.com", port: 587, secure: false, user: "me@test.com", password: "pw" },
    fromName: "Test User",
    ...overrides,
  };
}

const params = { to: "a@b.com", subject: "Subj", body: "Hello" };

before(async () => {
  mockSendEmail = mock.fn(() =>
    Promise.resolve({
      messageId: "<msg@test.com>",
      to: "a@b.com",
      subject: "Subj",
      raw: Buffer.from("RAW"),
    }),
  );
  mockAppendToSent = mock.fn(() => Promise.resolve("Sent"));

  mock.module("../src/clients/smtp-client.ts", {
    exports: { sendEmail: mockSendEmail },
  });
  mock.module("../src/clients/imap-client.ts", {
    exports: { appendToSent: mockAppendToSent },
  });

  ({ deliverEmail, savesSentCopyServerSide } = await import("../src/delivery.ts"));
});

describe("savesSentCopyServerSide", () => {
  it("detects Gmail hosts", () => {
    assert.strictEqual(
      savesSentCopyServerSide(baseConfig({ smtp: { host: "smtp.gmail.com" } })),
      true,
    );
    assert.strictEqual(
      savesSentCopyServerSide(baseConfig({ smtp: { host: "smtp.googlemail.com" } })),
      true,
    );
    assert.strictEqual(
      savesSentCopyServerSide(baseConfig({ smtp: { host: "smtp.example.com" } })),
      false,
    );
  });
});

describe("deliverEmail", () => {
  it("sends and saves a Sent copy", async () => {
    mockAppendToSent.mock.resetCalls();

    const result = await deliverEmail(baseConfig(), params);
    assert.strictEqual(result.result.messageId, "<msg@test.com>");
    assert.deepStrictEqual(result.sentCopy, { status: "saved", mailbox: "Sent" });
    assert.strictEqual(mockAppendToSent.mock.callCount(), 1);
  });

  it("skips the copy when disabled for the profile", async () => {
    const result = await deliverEmail(baseConfig({ appendToSent: false }), params);
    assert.deepStrictEqual(result.sentCopy, {
      status: "skipped",
      reason: "disabled for this profile",
    });
  });

  it("skips the copy for server-side filing providers", async () => {
    const result = await deliverEmail(
      baseConfig({ smtp: { host: "smtp.gmail.com" } }),
      params,
    );
    assert.deepStrictEqual(result.sentCopy, {
      status: "skipped",
      reason: "provider files sent mail server-side",
    });
  });

  it("skips when no Sent mailbox can be found", async () => {
    mockAppendToSent.mock.mockImplementationOnce(() => Promise.resolve(null));

    const result = await deliverEmail(baseConfig(), params);
    assert.deepStrictEqual(result.sentCopy, {
      status: "skipped",
      reason: "no Sent mailbox found; set sentMailbox in the profile",
    });
  });

  it("reports a failed copy without failing the send", async () => {
    mockAppendToSent.mock.mockImplementationOnce(() =>
      Promise.reject(new Error("append failed")),
    );

    const result = await deliverEmail(baseConfig(), params);
    assert.strictEqual(result.result.messageId, "<msg@test.com>");
    assert.deepStrictEqual(result.sentCopy, {
      status: "failed",
      reason: "append failed",
    });
  });
});
