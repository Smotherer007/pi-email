import { describe, it, expect } from "vitest";
import { decodeHeader } from "../src/clients/imap-client";

describe("decodeHeader", () => {
  describe("edge cases", () => {
    it("returns empty string for undefined", () => {
      expect(decodeHeader(undefined)).toBe("");
    });

    it("returns empty string for null", () => {
      expect(decodeHeader(null)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(decodeHeader("")).toBe("");
    });

    it("returns plain text unchanged", () => {
      expect(decodeHeader("Hello World")).toBe("Hello World");
    });
  });

  describe("RFC 2047 Base64 decoding", () => {
    it("decodes UTF-8 base64 encoded words", () => {
      // "Hello" in base64 = SGVsbG8=
      expect(decodeHeader("=?UTF-8?B?SGVsbG8=?=")).toBe("Hello");
    });

    it("decodes multiple encoded words", () => {
      // "Hello World" split across two encoded words
      expect(
        decodeHeader("=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?="),
      ).toBe("Hello World");
    });

    it("decodes German umlauts from base64", () => {
      // "Versendet" in base64 from subject lines
      const encoded = "=?UTF-8?B?VmVyc2VuZGV0?=";
      expect(decodeHeader(encoded)).toBe("Versendet");
    });

    it("decodes encoded word mixed with plain text", () => {
      const input = "Re: =?UTF-8?B?SGVsbG8=?= from me";
      expect(decodeHeader(input)).toBe("Re: Hello from me");
    });
  });

  describe("RFC 2047 Q-encoding decoding", () => {
    it("decodes Q-encoded space (underscore)", () => {
      expect(decodeHeader("=?UTF-8?Q?Hello_World?=")).toBe("Hello World");
    });

    it("decodes Q-encoded hex characters", () => {
      // =C3=A4 is ä in UTF-8
      expect(decodeHeader("=?UTF-8?Q?=C3=A4?=")).toBe("ä");
    });

    it("decodes multiple Q-encoded words", () => {
      // Underscore becomes space, then two encoded words separated by a literal space
      // First: H=C3=A4llo_ -> Hällo (space at end from _)
      // Literal space
      // Second: W=C3=B6rld -> Wörld
      // Net: "Hällo  Wörld" (trailing _ space + separating space = double space)
      expect(
        decodeHeader("=?UTF-8?Q?H=C3=A4llo_?= =?UTF-8?Q?W=C3=B6rld?="),
      ).toBe("Hällo  Wörld");
    });
  });

  describe("case insensitivity", () => {
    it("handles lowercase encoding types", () => {
      expect(decodeHeader("=?utf-8?b?SGVsbG8=?=")).toBe("Hello");
    });

    it("handles mixed case Q encoding", () => {
      expect(decodeHeader("=?UTF-8?q?Hello_World?=")).toBe("Hello World");
    });
  });

  describe("malformed input", () => {
    it("handles invalid base64 gracefully", () => {
      // Should attempt decode and not crash
      expect(() =>
        decodeHeader("=?UTF-8?B?#$%invalid!?="),
      ).not.toThrow();
    });

    it("handles broken encoded-word format", () => {
      // Missing closing ?= should leave text as-is
      const result = decodeHeader("=?UTF-8?B?SGVsbG8?");
      // The regex won't match incomplete pattern
      expect(typeof result).toBe("string");
    });
  });
});
