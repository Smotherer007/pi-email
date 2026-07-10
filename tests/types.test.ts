import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmailNotConfiguredError } from "../src/types.ts";

describe("EmailNotConfiguredError", () => {
  it("should have the correct name", () => {
    const err = new EmailNotConfiguredError();
    assert.strictEqual(err.name, "EmailNotConfiguredError");
  });

  it("should be an instance of Error", () => {
    const err = new EmailNotConfiguredError();
    assert.ok(err instanceof Error);
  });

  it("should have the correct message", () => {
    const err = new EmailNotConfiguredError();
    assert.strictEqual(
      err.message,
      "Email not configured. Use the email_setup tool first.",
    );
  });

  it("should be throwable and catchable", () => {
    assert.throws(() => {
      throw new EmailNotConfiguredError();
    }, EmailNotConfiguredError);
  });

  it("should be catchable by name", () => {
    try {
      throw new EmailNotConfiguredError();
    } catch (e: any) {
      assert.strictEqual(e.name, "EmailNotConfiguredError");
    }
  });
});
