import { describe, it, expect } from "vitest";
import { EmailNotConfiguredError } from "../src/types";

describe("EmailNotConfiguredError", () => {
  it("should have the correct name", () => {
    const err = new EmailNotConfiguredError();
    expect(err.name).toBe("EmailNotConfiguredError");
  });

  it("should be an instance of Error", () => {
    const err = new EmailNotConfiguredError();
    expect(err).toBeInstanceOf(Error);
  });

  it("should have the correct message", () => {
    const err = new EmailNotConfiguredError();
    expect(err.message).toBe(
      "Email not configured. Use the email_setup tool first.",
    );
  });

  it("should be throwable and catchable", () => {
    expect(() => {
      throw new EmailNotConfiguredError();
    }).toThrow(EmailNotConfiguredError);
  });

  it("should be catchable by name", () => {
    try {
      throw new EmailNotConfiguredError();
    } catch (e: any) {
      expect(e.name).toBe("EmailNotConfiguredError");
    }
  });
});
