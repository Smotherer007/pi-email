import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailFlagTool: any;
let mockOpenBox: any;
let mockAddFlags: any;
let mockDelFlags: any;
let mockEnd: any;

before(async () => {
  mockOpenBox = mock.fn((_box: any, _readonly: any, cb: any) => cb(null));
  mockAddFlags = mock.fn((_uid: any, _flags: any, cb: any) => cb(null));
  mockDelFlags = mock.fn((_uid: any, _flags: any, cb: any) => cb(null));
  mockEnd = mock.fn();

  mock.module("../src/clients/imap-client.ts", {
    exports: {
      connectImap: mock.fn(() => Promise.resolve({
        openBox: mockOpenBox,
        addFlags: mockAddFlags,
        delFlags: mockDelFlags,
        end: mockEnd,
      })),
    },
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
    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42 },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("No flags specified"));
  });

  it("adds Seen flag to mark as read", async () => {
    mockAddFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("flags updated"));
    assert.ok(result.content[0].text.includes("added: \\Seen"));

    assert.strictEqual(mockAddFlags.mock.callCount(), 1);
    const callArgs = mockAddFlags.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], 42);
    assert.deepStrictEqual(callArgs[1], ["\\Seen"]);
  });

  it("removes Seen flag to mark as unread", async () => {
    mockDelFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, remove: ["unread"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("removed: \\Seen"));

    const callArgs = mockDelFlags.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], 42);
    assert.deepStrictEqual(callArgs[1], ["\\Seen"]);
  });

  it("adds Flagged flag", async () => {
    mockAddFlags.mock.resetCalls();

    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["starred"] },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("added: \\Flagged"));

    const callArgs = mockAddFlags.mock.calls[0].arguments;
    assert.deepStrictEqual(callArgs[1], ["\\Flagged"]);
  });

  it("adds and removes flags simultaneously", async () => {
    mockAddFlags.mock.resetCalls();
    mockDelFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"], remove: ["Flagged"] },
      new AbortController().signal,
    );

    assert.strictEqual(mockAddFlags.mock.callCount(), 1);
    assert.deepStrictEqual(mockAddFlags.mock.calls[0].arguments[1], ["\\Seen"]);
    assert.strictEqual(mockDelFlags.mock.callCount(), 1);
    assert.deepStrictEqual(mockDelFlags.mock.calls[0].arguments[1], ["\\Flagged"]);
  });

  it("handles already-prefixed flags", async () => {
    mockAddFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["\\Seen"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockAddFlags.mock.calls[0].arguments[1], ["\\Seen"]);
  });

  it("handles 'read' alias for Seen", async () => {
    mockAddFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["read"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockAddFlags.mock.calls[0].arguments[1], ["\\Seen"]);
  });

  it("handles 'replied' alias for Answered", async () => {
    mockAddFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["replied"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockAddFlags.mock.calls[0].arguments[1], ["\\Answered"]);
  });

  it("passes through unknown flags with backslash prefix", async () => {
    mockAddFlags.mock.resetCalls();

    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["CustomFlag"] },
      new AbortController().signal,
    );
    assert.deepStrictEqual(mockAddFlags.mock.calls[0].arguments[1], ["\\CustomFlag"]);
  });
});
