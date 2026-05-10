/**
 * PDF text extraction.
 *
 * Uses system pdftotext (poppler-utils) to extract plain text from PDF files.
 * Returns empty string if pdftotext unavailable or extraction fails.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";

const execFileAsync = promisify(execFile);

export interface PdfContent {
  readonly filename: string;
  readonly text: string;
}

/**
 * Check whether pdftotext is available on the system PATH.
 */
export function pdftotextAvailable(): boolean {
  try {
    const result = require("node:child_process").spawnSync(
      "pdftotext",
      ["-v"],
      { stdio: "ignore", timeout: 2000 },
    );
    return result.status === 0 || result.error === undefined;
  } catch {
    return false;
  }
}

/**
 * Extract text from a single PDF file.
 * Returns the text content or empty string on failure.
 */
export async function extractPdfText(filePath: string): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      filePath,
      "-",
    ], {
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024, // 5 MB
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Extract text from all PDF files in a list of saved attachment paths.
 * Only processes files with .pdf extension.
 */
export async function extractPdfsFromAttachments(
  savedFiles: ReadonlyArray<string>,
): Promise<ReadonlyArray<PdfContent>> {
  const results: PdfContent[] = [];

  for (const filePath of savedFiles) {
    if (!filePath.toLowerCase().endsWith(".pdf")) continue;
    const text = await extractPdfText(filePath);
    const filename = filePath.split("/").pop() || filePath;
    results.push({ filename, text });
  }

  return results;
}
