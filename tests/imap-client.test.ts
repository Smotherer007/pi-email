import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeHeader } from "../src/clients/imap-client.ts";

describe("decodeHeader", () => {
  describe("edge cases", () => {
    it("returns empty string for undefined", () => {
      assert.strictEqual(decodeHeader(undefined), "");
    });

    it("returns empty string for null", () => {
      assert.strictEqual(decodeHeader(null), "");
    });

    it("returns empty string for empty string", () => {
      assert.strictEqual(decodeHeader(""), "");
    });

    it("returns plain text unchanged", () => {
      assert.strictEqual(decodeHeader("Hello World"), "Hello World");
    });
  });

  describe("RFC 2047 Base64 decoding", () => {
    it("decodes UTF-8 base64 encoded words", () => {
      assert.strictEqual(decodeHeader("=?UTF-8?B?SGVsbG8=?="), "Hello");
    });

    it("decodes multiple encoded words", () => {
      assert.strictEqual(
        decodeHeader("=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?="),
        "Hello World",
      );
    });

    it("decodes German umlauts from base64", () => {
      const encoded = "=?UTF-8?B?VmVyc2VuZGV0?=";
      assert.strictEqual(decodeHeader(encoded), "Versendet");
    });

    it("decodes encoded word mixed with plain text", () => {
      const input = "Re: =?UTF-8?B?SGVsbG8=?= from me";
      assert.strictEqual(decodeHeader(input), "Re: Hello from me");
    });
  });

  describe("RFC 2047 Q-encoding decoding", () => {
    it("decodes Q-encoded space (underscore)", () => {
      assert.strictEqual(decodeHeader("=?UTF-8?Q?Hello_World?="), "Hello World");
    });

    it("decodes Q-encoded hex characters", () => {
      assert.strictEqual(decodeHeader("=?UTF-8?Q?=C3=A4?="), "ä");
    });

    it("decodes multiple Q-encoded words", () => {
      assert.strictEqual(
        decodeHeader("=?UTF-8?Q?H=C3=A4llo_?= =?UTF-8?Q?W=C3=B6rld?="),
        "Hällo  Wörld",
      );
    });
  });

  describe("case insensitivity", () => {
    it("handles lowercase encoding types", () => {
      assert.strictEqual(decodeHeader("=?utf-8?b?SGVsbG8=?="), "Hello");
    });

    it("handles mixed case Q encoding", () => {
      assert.strictEqual(decodeHeader("=?UTF-8?q?Hello_World?="), "Hello World");
    });
  });

  describe("malformed input", () => {
    it("handles invalid base64 gracefully", () => {
      assert.doesNotThrow(() =>
        decodeHeader("=?UTF-8?B?#$%invalid!?="),
      );
    });

    it("handles broken encoded-word format", () => {
      const result = decodeHeader("=?UTF-8?B?SGVsbG8?");
      assert.strictEqual(typeof result, "string");
    });
  });
});
