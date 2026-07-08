import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/clients/imap-client", () => ({
  readEmail: vi.fn(),
}));

vi.mock("../src/clients/smtp-client", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("../src/config", () => ({
  resolveConfig: vi.fn(() => ({
    imap: { host: "imap.test.com", port: 993, tls: true, user: "me@test.com", password: "pw" },
    smtp: { host: "smtp.test.com", port: 587, secure: false, user: "me@test.com", password: "pw" },
    fromName: "Test User",
  })),
}));

import { EmailForwardTool } from "../src/tools/email-forward";
import { readEmail } from "../src/clients/imap-client";
import { sendEmail } from "../src/clients/smtp-client";

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

describe("EmailForwardTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readEmail as any).mockResolvedValue(mockOriginalEmail());
    (sendEmail as any).mockResolvedValue({
      messageId: "<fwd-xyz@mail.test.com>",
      to: "bob@example.com",
      subject: "Fwd: Important Report",
    });
  });

  it("has correct tool name", () => {
    expect(EmailForwardTool.name).toBe("email_forward");
  });

  it("forwards to specified recipient", async () => {
    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("Email forwarded successfully");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "bob@example.com",
        subject: "Fwd: Important Report",
      }),
    );
  });

  it("includes forwarding headers in body", async () => {
    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("---------- Forwarded message ----------");
    expect(callArgs.body).toContain("From: Alice <alice@example.com>");
    expect(callArgs.body).toContain("Subject: Important Report");
    expect(callArgs.body).toContain("To: Me <me@test.com>");
    expect(callArgs.body).toContain("Please review the attached report.");
  });

  it("includes optional comment above forwarding headers", async () => {
    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com", body: "FYI, please take a look." },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("FYI, please take a look.");
    // Comment should come before forwarding headers
    const commentPos = callArgs.body.indexOf("FYI, please take a look.");
    const fwdPos = callArgs.body.indexOf("---------- Forwarded message ----------");
    expect(commentPos).toBeLessThan(fwdPos);
  });

  it("includes CC line when original had CC", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      cc: { text: "Carol <carol@test.com>" },
    }));

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("CC: Carol <carol@test.com>");
  });

  it("lists attachment names in body", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      attachments: [
        { filename: "report.pdf", contentType: "application/pdf" },
        { filename: "image.png", contentType: "image/png" },
      ],
    }));

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("Attachments: report.pdf, image.png");
  });

  it("handles unnamed attachments gracefully", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      attachments: [{ contentType: "application/octet-stream" }],
    }));

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("Attachments: unnamed");
  });

  it("supports CC and BCC", async () => {
    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com", cc: "eve@example.com", bcc: "boss@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.cc).toBe("eve@example.com");
    expect(callArgs.bcc).toBe("boss@example.com");
  });

  it("handles missing subject gracefully", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({ subject: "" }));

    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    expect(result.content[0].text).toContain("Email forwarded successfully");
  });

  it("handles empty text body", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({ text: "" }));

    await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );

    const callArgs = (sendEmail as any).mock.calls[0][1];
    expect(callArgs.body).toContain("(no text content)");
  });

  it("reports attachment count in details", async () => {
    (readEmail as any).mockResolvedValue(mockOriginalEmail({
      attachments: [
        { filename: "a.pdf" },
        { filename: "b.pdf" },
      ],
    }));

    const result = await EmailForwardTool.execute(
      "call-1",
      { uid: 42, to: "bob@example.com" },
      new AbortController().signal,
    );
    expect(result.details.attachmentCount).toBe(2);
  });
});
