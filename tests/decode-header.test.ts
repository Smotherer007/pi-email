import { describe, it, expect } from "vitest";
import { decodeHeader } from "../src/clients/imap-client";

describe("decodeHeader", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(decodeHeader(null)).toBe("");
    expect(decodeHeader(undefined)).toBe("");
    expect(decodeHeader("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(decodeHeader("Hello World")).toBe("Hello World");
    expect(decodeHeader("test@example.com")).toBe("test@example.com");
  });

  it("decodes base64 (B) encoded UTF-8 text", () => {
    // "Patri ck" in UTF-8 base64 = UGF0cmljayBXZXBwZWxtYW5u
    const encoded = "=?UTF-8?B?UGF0cmljayBXZXBwZWxtYW5u?=";
    expect(decodeHeader(encoded)).toBe("Patrick Weppelmann");
  });

  it("decodes quoted-printable (Q) encoded text", () => {
    // Q encoding: =C3=A4 = ä in UTF-8
    const encoded = "=?UTF-8?Q?Gr=C3=BC=C3=9F_Gott?=";
    expect(decodeHeader(encoded)).toBe("Grüß Gott");
  });

  it("decodes mixed encoded and plain text", () => {
    const mixed = "Re: =?UTF-8?B?VGVzdCBFbWFpbA==?= from me";
    expect(decodeHeader(mixed)).toBe("Re: Test Email from me");
  });

  it("decodes multiple encoded words", () => {
    // Multiple encoded words separated by whitespace — space is preserved per RFC 2047
    const multi = "=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?=";
    expect(decodeHeader(multi)).toBe("Hello World");
  });

  it("handles Q encoding with underscores as spaces", () => {
    const encoded = "=?UTF-8?Q?Hello_World?=";
    expect(decodeHeader(encoded)).toBe("Hello World");
  });

  it("handles invalid encoding gracefully", () => {
    // Invalid base64
    const bad = "=?UTF-8?B?!!!invalid!!!?=";
    // Should return something without throwing
    const result = decodeHeader(bad);
    expect(typeof result).toBe("string");
  });
});
