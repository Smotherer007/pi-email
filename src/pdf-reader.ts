/**
 * PDF text extraction.
 *
 * Uses system pdftotext (poppler-utils) to extract plain text from PDF files.
 * Returns empty string if pdftotext unavailable or extraction fails.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

export interface PdfContent {
  readonly filename: string;
  readonly text: string;
}

/**
 * Check whether pdftotext is available on the system PATH.
 */
export async function pdftotextAvailable(): Promise<boolean> {
  try {
    await execFileAsync("pdftotext", ["-v"], { timeout: 2000 });
    return true;
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
 * If the signal is aborted or the 120s timeout is reached, returns
 * whatever results have been collected so far (graceful degradation).
 */
export async function extractPdfsFromAttachments(
  savedFiles: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlyArray<PdfContent>> {
  const timeoutSignal = signal ?? AbortSignal.timeout(120_000);
  const results: PdfContent[] = [];

  for (const filePath of savedFiles) {
    if (timeoutSignal.aborted) break;
    if (!filePath.toLowerCase().endsWith(".pdf")) continue;
    const text = await extractPdfText(filePath);
    const filename = path.basename(filePath);
    results.push({ filename, text });
  }

  return results;
}
