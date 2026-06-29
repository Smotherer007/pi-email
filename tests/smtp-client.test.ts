import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EmailConfig } from "../src/types";

const { createTransport, sendMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { sendEmail } from "../src/clients/smtp-client";

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

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "message-1" });
  createTransport.mockReset();
  createTransport.mockReturnValue({ sendMail });
});

describe("sendEmail", () => {
  it("passes local attachment paths to nodemailer", async () => {
    await sendEmail(config, {
      to: "recipient@example.com",
      subject: "Hi",
      body: "Hello",
      attachmentPaths: ["/tmp/report.pdf", "notes.txt"],
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: '"Sender" <sender@example.com>',
      to: "recipient@example.com",
      subject: "Hi",
      text: "Hello",
      disableUrlAccess: true,
      attachments: [{ path: "/tmp/report.pdf" }, { path: "notes.txt" }],
    });
  });

  it("omits attachments when none are provided", async () => {
    await sendEmail(config, {
      to: "recipient@example.com",
      subject: "Hi",
      body: "Hello",
    });

    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  it("rejects URL and data URI attachments", async () => {
    await expect(
      sendEmail(config, {
        to: "recipient@example.com",
        subject: "Hi",
        body: "Hello",
        attachmentPaths: ["https://example.com/report.pdf"],
      }),
    ).rejects.toThrow("Only local attachment paths are supported");

    await expect(
      sendEmail(config, {
        to: "recipient@example.com",
        subject: "Hi",
        body: "Hello",
        attachmentPaths: ["data:text/plain;base64,SGVsbG8="],
      }),
    ).rejects.toThrow("Only local attachment paths are supported");

    expect(sendMail).not.toHaveBeenCalled();
  });
});
