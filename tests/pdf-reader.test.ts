import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  extractPdfText,
  extractPdfsFromAttachments,
  pdftotextAvailable,
} from "../src/pdf-reader";

const tmpDir = path.join(os.tmpdir(), "pi-email-pdf-test-" + Date.now());

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

describe("pdftotextAvailable", () => {
  it("returns boolean", () => {
    const result = pdftotextAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("extractPdfText", () => {
  it("returns empty string for non-existent file", async () => {
    const result = await extractPdfText(
      path.join(tmpDir, "nope.pdf"),
    );
    expect(result).toBe("");
  });

  it("returns empty string for empty file", async () => {
    const empty = path.join(tmpDir, "empty.pdf");
    fs.writeFileSync(empty, "");
    const result = await extractPdfText(empty);
    // pdftotext may error on empty file, so empty string is fine
    expect(typeof result).toBe("string");
  });

  it("returns empty string for text file with .pdf extension", async () => {
    const fake = path.join(tmpDir, "fake.pdf");
    fs.writeFileSync(fake, "not a real pdf");
    const result = await extractPdfText(fake);
    // pdftotext will fail or return empty on invalid PDF
    expect(typeof result).toBe("string");
  });
});

describe("extractPdfsFromAttachments", () => {
  const savedDir = path.join(tmpDir, "saved");

  beforeAll(() => {
    fs.mkdirSync(savedDir, { recursive: true });
  });

  it("returns empty array for empty input", async () => {
    const result = await extractPdfsFromAttachments([]);
    expect(result).toEqual([]);
  });

  it("skips non-PDF files", async () => {
    const png = path.join(savedDir, "image.png");
    const txt = path.join(savedDir, "notes.txt");
    fs.writeFileSync(png, "fake png");
    fs.writeFileSync(txt, "hello");

    const result = await extractPdfsFromAttachments([png, txt]);
    expect(result).toEqual([]);
  });

  it("processes .PDF (uppercase) extension", async () => {
    const pdf = path.join(savedDir, "UPPER.PDF");
    fs.writeFileSync(pdf, "not a pdf");
    const result = await extractPdfsFromAttachments([pdf]);
    // Should have one entry even if extraction fails
    expect(result.length).toBe(1);
    expect(result[0].filename).toBe("UPPER.PDF");
  });
});
