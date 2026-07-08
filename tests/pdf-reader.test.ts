import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  pdftotextAvailable,
  extractPdfText,
  extractPdfsFromAttachments,
} from "../src/pdf-reader";

describe("pdftotextAvailable", () => {
  it("returns a boolean", async () => {
    const result = await pdftotextAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("extractPdfText", () => {
  it("returns empty string for non-existent file", async () => {
    const result = await extractPdfText("/tmp/does-not-exist-12345.pdf");
    expect(result).toBe("");
  });

  it("returns empty string for non-PDF file", async () => {
    const tmpFile = path.join(os.tmpdir(), "test-not-pdf.txt");
    fs.writeFileSync(tmpFile, "hello");
    try {
      const result = await extractPdfText(tmpFile);
      expect(result).toBe("");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("extractPdfsFromAttachments", () => {
  it("returns empty array for empty input", async () => {
    const result = await extractPdfsFromAttachments([]);
    expect(result).toEqual([]);
  });

  it("skips non-PDF files", async () => {
    const tmpFile = path.join(os.tmpdir(), "test-image.png");
    fs.writeFileSync(tmpFile, "not a png");
    try {
      const result = await extractPdfsFromAttachments([tmpFile]);
      expect(result).toEqual([]);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("handles non-existent PDF gracefully (returns empty text)", async () => {
    const result = await extractPdfsFromAttachments([
      "/tmp/ghost-99999.pdf",
    ]);
    expect(result).toEqual([{ filename: "ghost-99999.pdf", text: "" }]);
  });

  it("handles mix of PDF and non-PDF files", async () => {
    const txtFile = path.join(os.tmpdir(), "note.txt");
    const pngFile = path.join(os.tmpdir(), "img.png");
    fs.writeFileSync(txtFile, "text");
    fs.writeFileSync(pngFile, "png");
    try {
      const result = await extractPdfsFromAttachments([txtFile, pngFile]);
      expect(result).toEqual([]);
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
    expect(result).toEqual([]);
  });
});
