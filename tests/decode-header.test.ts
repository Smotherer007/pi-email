import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeHeader } from "../src/clients/imap-client.ts";

describe("decodeHeader", () => {
  it("returns empty string for null/undefined/empty", () => {
    assert.strictEqual(decodeHeader(null), "");
    assert.strictEqual(decodeHeader(undefined), "");
    assert.strictEqual(decodeHeader(""), "");
  });

  it("returns plain text unchanged", () => {
    assert.strictEqual(decodeHeader("Hello World"), "Hello World");
    assert.strictEqual(decodeHeader("test@example.com"), "test@example.com");
  });

  it("decodes base64 (B) encoded UTF-8 text", () => {
    const encoded = "=?UTF-8?B?UGF0cmljayBXZXBwZWxtYW5u?=";
    assert.strictEqual(decodeHeader(encoded), "Patrick Weppelmann");
  });

  it("decodes quoted-printable (Q) encoded text", () => {
    const encoded = "=?UTF-8?Q?Gr=C3=BC=C3=9F_Gott?=";
    assert.strictEqual(decodeHeader(encoded), "Grüß Gott");
  });

  it("decodes mixed encoded and plain text", () => {
    const mixed = "Re: =?UTF-8?B?VGVzdCBFbWFpbA==?= from me";
    assert.strictEqual(decodeHeader(mixed), "Re: Test Email from me");
  });

  it("decodes multiple encoded words", () => {
    const multi = "=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?=";
    assert.strictEqual(decodeHeader(multi), "Hello World");
  });

  it("handles Q encoding with underscores as spaces", () => {
    const encoded = "=?UTF-8?Q?Hello_World?=";
    assert.strictEqual(decodeHeader(encoded), "Hello World");
  });

  it("handles invalid encoding gracefully", () => {
    const bad = "=?UTF-8?B?!!!invalid!!!?=";
    const result = decodeHeader(bad);
    assert.strictEqual(typeof result, "string");
  });
});
