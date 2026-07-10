import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  pdftotextAvailable,
  extractPdfText,
  extractPdfsFromAttachments,
} from "../src/pdf-reader.ts";

describe("pdftotextAvailable", () => {
  it("returns a boolean", async () => {
    const result = await pdftotextAvailable();
    assert.strictEqual(typeof result, "boolean");
  });
});

describe("extractPdfText", () => {
  it("returns empty string for non-existent file", async () => {
    const result = await extractPdfText("/tmp/does-not-exist-12345.pdf");
    assert.strictEqual(result, "");
  });

  it("returns empty string for non-PDF file", async () => {
    const tmpFile = path.join(os.tmpdir(), "test-not-pdf.txt");
    fs.writeFileSync(tmpFile, "hello");
    try {
      const result = await extractPdfText(tmpFile);
      assert.strictEqual(result, "");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("extractPdfsFromAttachments", () => {
  it("returns empty array for empty input", async () => {
    const result = await extractPdfsFromAttachments([]);
    assert.deepStrictEqual(result, []);
  });

  it("skips non-PDF files", async () => {
    const tmpFile = path.join(os.tmpdir(), "test-image.png");
    fs.writeFileSync(tmpFile, "not a png");
    try {
      const result = await extractPdfsFromAttachments([tmpFile]);
      assert.deepStrictEqual(result, []);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("handles non-existent PDF gracefully (returns empty text)", async () => {
    const result = await extractPdfsFromAttachments(["/tmp/ghost-99999.pdf"]);
    assert.deepStrictEqual(result, [{ filename: "ghost-99999.pdf", text: "" }]);
  });

  it("handles mix of PDF and non-PDF files", async () => {
    const txtFile = path.join(os.tmpdir(), "note.txt");
    const pngFile = path.join(os.tmpdir(), "img.png");
    fs.writeFileSync(txtFile, "text");
    fs.writeFileSync(pngFile, "png");
    try {
      const result = await extractPdfsFromAttachments([txtFile, pngFile]);
      assert.deepStrictEqual(result, []);
    } finally {
      fs.unlinkSync(txtFile);
      fs.unlinkSync(pngFile);
    }
  });

  it("stops on abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await extractPdfsFromAttachments(
      ["/tmp/any.pdf"],
      controller.signal,
    );
    assert.deepStrictEqual(result, []);
  });
});
