import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailFlagTool: any;
let mockSetFlags: any;

before(async () => {
  mockSetFlags = mock.fn(() => Promise.resolve(undefined));

  mock.module("../src/clients/imap-client.ts", {
    exports: { setFlags: mockSetFlags },
  });

  mock.module("../src/config.ts", {
    exports: {
      resolveConfig: mock.fn(() => ({
        imap: { host: "imap.test.com", port: 993, tls: true, user: "test@test.com", password: "pw" },
        smtp: { host: "smtp.test.com", port: 587, secure: false, user: "test@test.com", password: "pw" },
      })),
    },
  });

  ({ EmailFlagTool } = await import("../src/tools/email-flag.ts"));
});

describe("EmailFlagTool", () => {
  it("has correct tool name", () => {
    assert.strictEqual(EmailFlagTool.name, "email_flag");
  });

  it("returns message when no flags specified", async () => {
    mockSetFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42 },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("No flags specified"));
    assert.strictEqual(mockSetFlags.mock.callCount(), 0);
  });

  it("adds Seen flag to mark as read", async () => {
    mockSetFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("flags updated"));
    assert.ok(result.content[0].text.includes("added: \\Seen"));

    assert.strictEqual(mockSetFlags.mock.callCount(), 1);
    const callArgs = mockSetFlags.mock.calls[0].arguments;
    assert.strictEqual(callArgs[1], 42);
    assert.strictEqual(callArgs[2], "INBOX");
    assert.deepStrictEqual(callArgs[3], ["\\Seen"]);
    assert.deepStrictEqual(callArgs[4], []);
  });

  it("removes Seen flag to mark as unread", async () => {
    mockSetFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, remove: ["unread"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("removed: \\Seen"));

    const callArgs = mockSetFlags.mock.calls[0].arguments;
    assert.strictEqual(callArgs[1], 42);
    assert.deepStrictEqual(callArgs[3], []);
    assert.deepStrictEqual(callArgs[4], ["\\Seen"]);
  });

  it("adds Flagged flag", async () => {
    mockSetFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["starred"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("added: \\Flagged"));

    const callArgs = mockSetFlags.mock.calls[0].arguments;
    assert.deepStrictEqual(callArgs[3], ["\\Flagged"]);
  });

  it("adds and removes flags simultaneously", async () => {
    mockSetFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"], remove: ["Flagged"] },
      new AbortController().signal,
    );

    assert.strictEqual(mockSetFlags.mock.callCount(), 1);
    const callArgs = mockSetFlags.mock.calls[0].arguments;
    assert.deepStrictEqual(callArgs[3], ["\\Seen"]);
    assert.deepStrictEqual(callArgs[4], ["\\Flagged"]);
  });

  it("handles already-prefixed flags", async () => {
    mockSetFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["\\Seen"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockSetFlags.mock.calls[0].arguments[3], ["\\Seen"]);
  });

  it("handles 'read' alias for Seen", async () => {
    mockSetFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["read"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockSetFlags.mock.calls[0].arguments[3], ["\\Seen"]);
  });

  it("handles 'replied' alias for Answered", async () => {
    mockSetFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["replied"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockSetFlags.mock.calls[0].arguments[3], ["\\Answered"]);
  });

  it("passes through unknown flags with backslash prefix", async () => {
    mockSetFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["CustomFlag"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockSetFlags.mock.calls[0].arguments[3], ["\\CustomFlag"]);
  });
});
