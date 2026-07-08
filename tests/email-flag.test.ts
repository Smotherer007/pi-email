import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IMAP client before importing the tool
vi.mock("../src/clients/imap-client", () => ({
  connectImap: vi.fn(),
}));

vi.mock("../src/config", () => ({
  resolveConfig: vi.fn(() => ({
    imap: { host: "imap.test.com", port: 993, tls: true, user: "test@test.com", password: "pw" },
    smtp: { host: "smtp.test.com", port: 587, secure: false, user: "test@test.com", password: "pw" },
  })),
}));

import { EmailFlagTool } from "../src/tools/email-flag";
import { connectImap } from "../src/clients/imap-client";

describe("EmailFlagTool", () => {
  let mockImap: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockImap = {
      openBox: vi.fn((_box: string, _readonly: boolean, cb: (err: any) => void) => cb(null)),
      addFlags: vi.fn((_uid: number, _flags: string[], cb: (err: any) => void) => cb(null)),
      delFlags: vi.fn((_uid: number, _flags: string[], cb: (err: any) => void) => cb(null)),
      end: vi.fn(),
    };
    (connectImap as any).mockResolvedValue(mockImap);
  });

  it("has correct tool name", () => {
    expect(EmailFlagTool.name).toBe("email_flag");
  });

  it("returns message when no flags specified", async () => {
    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42 },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("No flags specified");
  });

  it("adds Seen flag to mark as read", async () => {
    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"] },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("flags updated");
    expect(result.content[0].text).toContain("added: \\Seen");
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Seen"], expect.any(Function));
  });

  it("removes Seen flag to mark as unread", async () => {
    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, remove: ["unread"] },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("removed: \\Seen");
    expect(mockImap.delFlags).toHaveBeenCalledWith(42, ["\\Seen"], expect.any(Function));
  });

  it("adds Flagged flag", async () => {
    const result = await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["starred"] },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("added: \\Flagged");
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Flagged"], expect.any(Function));
  });

  it("adds and removes flags simultaneously", async () => {
    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["Seen"], remove: ["Flagged"] },
      new AbortController().signal,
    );
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Seen"], expect.any(Function));
    expect(mockImap.delFlags).toHaveBeenCalledWith(42, ["\\Flagged"], expect.any(Function));
  });

  it("handles already-prefixed flags", async () => {
    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["\\Seen"] },
      new AbortController().signal,
    );
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Seen"], expect.any(Function));
  });

  it("handles 'read' alias for Seen", async () => {
    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["read"] },
      new AbortController().signal,
    );
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Seen"], expect.any(Function));
  });

  it("handles 'replied' alias for Answered", async () => {
    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["replied"] },
      new AbortController().signal,
    );
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\Answered"], expect.any(Function));
  });

  it("passes through unknown flags with backslash prefix", async () => {
    await EmailFlagTool.execute(
      "call-1",
      { uid: 42, add: ["CustomFlag"] },
      new AbortController().signal,
    );
    expect(mockImap.addFlags).toHaveBeenCalledWith(42, ["\\CustomFlag"], expect.any(Function));
  });
});
