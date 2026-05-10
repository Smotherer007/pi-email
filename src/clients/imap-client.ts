/**
 * IMAP client operations.
 *
 * Pure async operations over IMAP. Returns plain data, never mutates state.
 * Connection lifecycle is managed per-call (open, use, close).
 */

import Imap from "imap";
import type { ParsedMail } from "mailparser";
import { simpleParser } from "mailparser";
import type { EmailConfig, EmailHeader, MailboxInfo } from "../types";

// ── Connection ──────────────────────────────────────────────────────────────

export function connectImap(config: EmailConfig): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.imap.user,
      password: config.imap.password,
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 30000,
    });

    imap.once("ready", () => resolve(imap));
    imap.once("error", (err: Error) => reject(err));
    imap.connect();
  });
}

// ── RFC 2047 header decoding ────────────────────────────────────────────────

export function decodeHeader(value: string | undefined | null): string {
  if (!value) return "";
  try {
    return value.replace(
      /=\?([^?]+)\?([QB])\?([^?]*)\?=/gi,
      (_match, _charset, encoding, text) => {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(text, "base64").toString("utf-8");
        }
        // Q encoding: =xx hex, _ -> space
        // Replace _ with space, then convert each =XX hex pair to
        // the corresponding byte. Interpret the result as latin-1
        // and convert to UTF-8 (so multi-byte UTF-8 sequences work).
        const raw = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        return Buffer.from(raw, "latin1").toString("utf-8");
      },
    );
  } catch {
    return value;
  }
}

// ── Mailbox listing ─────────────────────────────────────────────────────────

export function listMailboxes(config: EmailConfig): Promise<ReadonlyArray<MailboxInfo>> {
  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);
    imap.getBoxes((err: Error | null, boxes: any) => {
      imap.end();
      if (err) return reject(err);

      function walk(tree: any): MailboxInfo[] {
        const result: MailboxInfo[] = [];
        for (const [name, box] of Object.entries(tree) as [string, any][]) {
          const selectable = !box.attribs || box.attribs.indexOf("\\Noselect") === -1;
          result.push({
            name,
            selectable,
            children: box.children ? walk(box.children) : [],
          });
        }
        return result;
      }

      resolve(walk(boxes));
    });
  });
}

// ── Fetch headers ───────────────────────────────────────────────────────────

export function fetchHeaders(
  config: EmailConfig,
  mailbox: string,
  limit: number,
  unseen: boolean,
): Promise<{ headers: EmailHeader[]; total: number }> {
  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);

    imap.openBox(mailbox, false, (err: Error, box: any) => {
      if (err) {
        imap.end();
        return reject(err);
      }

      const total = box.messages.total;
      if (total === 0) {
        imap.end();
        return resolve({ headers: [], total: 0 });
      }

      const criteria: any[] = unseen ? [["UNSEEN"]] : [["ALL"]];
      imap.search(criteria, (err: Error, results: number[]) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        if (results.length === 0) {
          imap.end();
          return resolve({ headers: [], total });
        }

        const subset = results.slice(-limit);
        const fetch = imap.fetch(subset, {
          bodies: "HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE)",
          struct: true,
        });

        const headers: EmailHeader[] = [];

        fetch.on("message", (msg: any, seqno: number) => {
          const header: EmailHeader = {
            uid: seqno,
            from: "",
            to: "",
            cc: "",
            bcc: "",
            subject: "",
            date: "",
            flags: [],
          };

          msg.on("body", (stream: any) => {
            let buffer = "";
            stream.on("data", (chunk: Buffer) => (buffer += chunk.toString("utf8")));
            stream.once("end", () => {
              const parsed = Imap.parseHeader(buffer);
              header.from = decodeHeader(parsed.from?.[0] || "");
              header.to = decodeHeader(parsed.to?.[0] || "");
              header.cc = decodeHeader(parsed.cc?.[0] || "");
              header.bcc = decodeHeader(parsed.bcc?.[0] || "");
              header.subject = decodeHeader(parsed.subject?.[0] || "");
              header.date = parsed.date?.[0] || "";
            });
          });

          msg.once("attributes", (attrs: any) => {
            header.flags = attrs.flags || [];
            header.uid = attrs.uid || seqno;
          });

          msg.once("end", () => {
            headers.push(header);
          });
        });

        fetch.once("error", (err: Error) => {
          imap.end();
          reject(err);
        });

        fetch.once("end", () => {
          imap.end();
          headers.sort((a, b) => b.uid - a.uid);
          resolve({ headers, total });
        });
      });
    });
  });
}

// ── Read full email ─────────────────────────────────────────────────────────

export function readEmail(
  config: EmailConfig,
  uid: number,
  mailbox: string,
  downloadDir: string | null,
): Promise<{ parsed: ParsedMail; savedFiles: string[] }> {
  const fs = require("node:fs");
  const path = require("node:path");

  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);

    imap.openBox(mailbox, false, (err: Error) => {
      if (err) {
        imap.end();
        return reject(err);
      }

      const fetch = imap.fetch(uid, { bodies: "", struct: true });
      let resolved = false;

      fetch.on("message", (msg: any) => {
        msg.on("body", (stream: any) => {
          let buffer = "";
          stream.on("data", (chunk: Buffer) => (buffer += chunk.toString("utf8")));
          stream.once("end", async () => {
            try {
              const parsed = await simpleParser(buffer);
              const savedFiles: string[] = [];

              if (downloadDir && parsed.attachments?.length) {
                if (!fs.existsSync(downloadDir)) {
                  fs.mkdirSync(downloadDir, { recursive: true });
                }
                for (const att of parsed.attachments) {
                  const safeName = att.filename || `attachment-${Date.now()}`;
                  const filePath = path.join(downloadDir, safeName);
                  fs.writeFileSync(filePath, att.content);
                  savedFiles.push(filePath);
                }
              }

              resolved = true;
              resolve({ parsed, savedFiles });
            } catch (e) {
              if (!resolved) {
                resolved = true;
                reject(e);
              }
            }
          });
        });
      });

      fetch.once("error", (err: Error) => {
        imap.end();
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      fetch.once("end", () => {
        imap.end();
      });
    });
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

export function searchEmails(
  config: EmailConfig,
  mailbox: string,
  criteria: any[],
  limit: number,
): Promise<{ headers: EmailHeader[]; totalResults: number }> {
  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);

    imap.openBox(mailbox, false, (err: Error) => {
      if (err) {
        imap.end();
        return reject(err);
      }

      const searchCriteria = criteria.length === 0 ? ["ALL"] : criteria;

      imap.search(searchCriteria, (err: Error, results: number[]) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        if (results.length === 0) {
          imap.end();
          return resolve({ headers: [], totalResults: 0 });
        }

        const subset = results.slice(-limit);
        const fetch = imap.fetch(subset, {
          bodies: "HEADER.FIELDS (FROM TO SUBJECT DATE)",
        });

        const headers: EmailHeader[] = [];

        fetch.on("message", (msg: any, seqno: number) => {
          const header: EmailHeader = {
            uid: seqno,
            from: "",
            to: "",
            cc: "",
            bcc: "",
            subject: "",
            date: "",
            flags: [],
          };
          msg.on("body", (stream: any) => {
            let buffer = "";
            stream.on("data", (chunk: Buffer) => (buffer += chunk.toString("utf8")));
            stream.once("end", () => {
              const parsed = Imap.parseHeader(buffer);
              header.from = decodeHeader(parsed.from?.[0] || "");
              header.to = decodeHeader(parsed.to?.[0] || "");
              header.subject = decodeHeader(parsed.subject?.[0] || "");
              header.date = parsed.date?.[0] || "";
            });
          });
          msg.once("end", () => headers.push(header));
        });

        fetch.once("error", (err: Error) => {
          imap.end();
          reject(err);
        });

        fetch.once("end", () => {
          imap.end();
          headers.sort((a, b) => b.uid - a.uid);
          resolve({ headers, totalResults: results.length });
        });
      });
    });
  });
}

// ── Delete ──────────────────────────────────────────────────────────────────

export function deleteEmail(
  config: EmailConfig,
  uid: number,
  mailbox: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);

    imap.openBox(mailbox, false, (err: Error) => {
      if (err) {
        imap.end();
        return reject(err);
      }

      imap.addFlags(uid, "\\Deleted", (err: Error) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        imap.expunge((err: Error) => {
          imap.end();
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });
}

// ── Move ────────────────────────────────────────────────────────────────────

export function moveEmail(
  config: EmailConfig,
  uid: number,
  source: string,
  destination: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const imap = await connectImap(config);

    imap.openBox(source, false, (err: Error) => {
      if (err) {
        imap.end();
        return reject(err);
      }

      imap.move(uid, destination, (err: Error) => {
        imap.end();
        if (err) return reject(err);
        resolve();
      });
    });
  });
}
