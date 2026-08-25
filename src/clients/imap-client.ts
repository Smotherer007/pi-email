/**
 * IMAP client operations.
 *
 * Pure async operations over IMAP. Returns plain data, never mutates state.
 * Connection lifecycle is managed per-call (open, use, close) by `runImap`,
 * which is the single place that owns error handling, timeouts and cleanup.
 */

import Imap from "imap";
import type { ParsedMail } from "mailparser";
import { simpleParser } from "mailparser";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EmailConfig, EmailHeader, MailboxInfo } from "../types.ts";
import { EmailNotFoundError, UnsafeAttachmentPathError } from "../types.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const SHORT_TIMEOUT_MS = 30_000;

// Connection

let cachedVersion: string | undefined;

function getClientVersion(): string {
  if (!cachedVersion) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      );
      cachedVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
    } catch {
      cachedVersion = "unknown";
    }
  }
  return cachedVersion;
}

export function connectImap(config: EmailConfig): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.imap.user,
      password: config.imap.password,
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.tls,
      tlsOptions: {
        servername: config.imap.host,
        // Certificate validation is on unless the profile explicitly opts out
        // (local bridges such as ProtonMail Bridge use self-signed certs).
        rejectUnauthorized: config.imap.rejectUnauthorized !== false,
      },
      connTimeout: 30000,
      authTimeout: 30000,
    });

    let settled = false;

    // Both listeners are removed once the connection is handed over, so the
    // caller (runImap) becomes the sole owner of the "error" event. Leaving
    // ours attached would swallow later errors on an already-settled promise.
    const cleanup = () => {
      imap.removeListener("ready", onReady);
      imap.removeListener("error", onError);
    };

    const onReady = () => {
      if (settled) return;
      // RFC 2971: identify the client. Required by NetEase (163/126) IMAP,
      // which rejects mailbox access without it ("Unsafe Login"). Harmless
      // for servers that merely advertise the ID capability, and skipped
      // entirely when the server does not. Failures never block login.
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(imap);
      };
      try {
        if (imap.serverSupports("ID")) {
          imap.id({ name: "pi-email", version: getClientVersion() }, done);
        } else {
          done();
        }
      } catch {
        done();
      }
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        imap.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    imap.once("ready", onReady);
    imap.once("error", onError);

    try {
      imap.connect();
    } catch (err) {
      onError(err as Error);
    }
  });
}

// Operation runner

export interface Settle<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
  readonly settled: boolean;
  /**
   * Wrap a node-imap callback. node-imap invokes callbacks from its socket
   * parser, so a synchronous throw inside one (e.g. an invalid SEARCH date)
   * escapes as an uncaught exception and takes the host process down.
   * Guarded callbacks turn that into a normal promise rejection.
   */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
}

/**
 * Run a single IMAP operation with a managed connection.
 *
 * Guarantees, none of which the previous `new Promise(async ...)` form could
 * make: connection failures reject the returned promise (instead of becoming
 * an unhandled rejection that terminates the process), every operation has a
 * timeout, errors raised after a successful connect are surfaced, and the
 * connection is always closed exactly once.
 */
export function runImap<T>(
  config: EmailConfig,
  signal: AbortSignal | undefined,
  operation: (imap: Imap, settle: Settle<T>) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutSignal = signal ?? AbortSignal.timeout(timeoutMs);
    let settled = false;
    let connection: Imap | null = null;

    function finish(deliver: () => void): void {
      if (settled) return;
      settled = true;
      timeoutSignal.removeEventListener("abort", onAbort);
      if (connection) {
        try {
          connection.end();
        } catch {
          /* ignore */
        }
      }
      deliver();
    }

    function onAbort(): void {
      finish(() =>
        reject(new DOMException("IMAP operation timed out", "TimeoutError")),
      );
    }

    const settle: Settle<T> = {
      resolve: (value) => finish(() => resolve(value)),
      reject: (error) => finish(() => reject(error)),
      get settled() {
        return settled;
      },
      guard:
        <A extends unknown[]>(fn: (...args: A) => void) =>
        (...args: A) => {
          try {
            fn(...args);
          } catch (err) {
            settle.reject(err);
          }
        },
    };

    if (timeoutSignal.aborted) {
      settled = true;
      reject(new DOMException("IMAP operation aborted", "AbortError"));
      return;
    }
    timeoutSignal.addEventListener("abort", onAbort, { once: true });

    connectImap(config).then(
      (imap) => {
        if (settled) {
          try {
            imap.end();
          } catch {
            /* ignore */
          }
          return;
        }
        connection = imap;
        imap.on("error", (err: Error) => settle.reject(err));
        imap.once("close", () =>
          settle.reject(
            new Error("IMAP connection closed before the operation finished."),
          ),
        );
        settle.guard(() => operation(imap, settle))();
      },
      (err) => settle.reject(err),
    );
  });
}

// RFC 2047 header decoding

/**
 * Decode a byte sequence using the charset named in an encoded-word.
 * Falls back to UTF-8 for unknown labels.
 */
function decodeBytes(bytes: Buffer, charset: string): string {
  const label = (charset || "utf-8").split("*")[0].trim().toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString("utf-8");
  }
}

export function decodeHeader(value: string | undefined | null): string {
  if (!value) return "";
  try {
    return value.replace(
      /=\?([^?]+)\?([QB])\?([^?]*)\?=/gi,
      (_match, charset: string, encoding: string, text: string) => {
        if (encoding.toUpperCase() === "B") {
          return decodeBytes(Buffer.from(text, "base64"), charset);
        }
        // Q encoding: =xx hex, _ -> space. Build the raw byte sequence first,
        // then decode it with the charset the sender declared -- decoding as
        // UTF-8 unconditionally turned ISO-8859-1 umlauts into mojibake.
        const raw = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        return decodeBytes(Buffer.from(raw, "latin1"), charset);
      },
    );
  } catch {
    return value;
  }
}

// Attachment filename safety

/** Strip control characters without embedding them in a regex literal. */
function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}

/**
 * Turn an attachment filename from an untrusted message into a name that
 * cannot escape the download directory. Attackers control this string, so
 * directory components, traversal segments and control characters all go.
 */
export function safeAttachmentName(
  raw: string | undefined | null,
  index: number,
): string {
  const fallback = `attachment-${index + 1}`;
  if (!raw) return fallback;

  // Treat both separators as such: a Windows-style name reaching a POSIX
  // host would otherwise keep its backslashes and slip through basename().
  let name = path.basename(raw.replace(/\\/g, "/"));
  name = stripControlChars(name).trim();
  // A leading dot would create hidden files and is the tail of "..".
  name = name.replace(/^\.+/, "");

  if (!name || name === "." || name === "..") return fallback;
  return name;
}

/** Resolve a target path inside downloadDir, or throw if it would escape. */
function resolveAttachmentPath(downloadDir: string, name: string): string {
  const dir = path.resolve(downloadDir);
  const target = path.resolve(dir, name);
  const relative = path.relative(dir, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new UnsafeAttachmentPathError(name);
  }
  return target;
}

/** Never silently overwrite an existing file in the download directory. */
function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

// Mailbox listing

interface RawBox {
  attribs?: string[];
  delimiter?: string;
  children?: Record<string, RawBox>;
}

function walkBoxes(tree: Record<string, RawBox>, prefix = ""): MailboxInfo[] {
  const result: MailboxInfo[] = [];
  for (const [name, box] of Object.entries(tree || {})) {
    const attributes = box.attribs ?? [];
    const selectable = attributes.indexOf("\\Noselect") === -1;
    const fullPath = prefix + name;
    const delimiter = box.delimiter || "/";
    result.push({
      name,
      selectable,
      path: fullPath,
      attributes,
      children: box.children ? walkBoxes(box.children, fullPath + delimiter) : [],
    });
  }
  return result;
}

export function listMailboxes(
  config: EmailConfig,
  signal?: AbortSignal,
): Promise<ReadonlyArray<MailboxInfo>> {
  return runImap<ReadonlyArray<MailboxInfo>>(
    config,
    signal,
    (imap, settle) => {
      imap.getBoxes(
        settle.guard((err: Error | null, boxes: Record<string, RawBox>) => {
          if (err) return settle.reject(err);
          settle.resolve(walkBoxes(boxes));
        }),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}

/** Flatten a mailbox tree into full paths with their attributes. */
export function flattenMailboxes(
  boxes: ReadonlyArray<MailboxInfo>,
): Array<{ path: string; attributes: ReadonlyArray<string> }> {
  const out: Array<{ path: string; attributes: ReadonlyArray<string> }> = [];
  for (const box of boxes) {
    out.push({ path: box.path ?? box.name, attributes: box.attributes ?? [] });
    if (box.children.length > 0) out.push(...flattenMailboxes(box.children));
  }
  return out;
}

// Fetch headers

function emptyHeader(uid: number): EmailHeader {
  return {
    uid,
    from: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    date: "",
    flags: [],
  };
}

/**
 * Wire up the per-message listeners shared by fetchHeaders and searchEmails.
 *
 * The `attributes` listener is what supplies the real UID: the second argument
 * of node-imap's "message" event is a sequence number, and searchEmails used
 * to report that as the UID -- so every follow-up email_read/_delete/_move on
 * a search result addressed a different message.
 */
function collectHeaders(fetch: any, headers: EmailHeader[]): void {
  fetch.on("message", (msg: any, seqno: number) => {
    const header = emptyHeader(seqno) as any;

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
      if (typeof attrs.uid === "number") header.uid = attrs.uid;
    });

    msg.once("end", () => headers.push(header as EmailHeader));
  });
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.floor(limit);
}

export function fetchHeaders(
  config: EmailConfig,
  mailbox: string,
  limit: number,
  unseen: boolean,
  signal?: AbortSignal,
): Promise<{ headers: EmailHeader[]; total: number }> {
  return runImap<{ headers: EmailHeader[]; total: number }>(
    config,
    signal,
    (imap, settle) => {
      imap.openBox(
        mailbox,
        true,
        settle.guard((err: Error, box: any) => {
          if (err) return settle.reject(err);

          const total = box.messages.total;
          if (total === 0) return settle.resolve({ headers: [], total: 0 });

          const criteria: any[] = unseen ? ["UNSEEN"] : ["ALL"];
          imap.search(
            criteria,
            settle.guard((err: Error, results: number[]) => {
              if (err) return settle.reject(err);
              if (results.length === 0) {
                return settle.resolve({ headers: [], total });
              }

              const subset = results.slice(-normalizeLimit(limit));
              const fetch = imap.fetch(subset, {
                bodies: "HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE)",
                struct: true,
              });

              const headers: EmailHeader[] = [];
              collectHeaders(fetch, headers);

              fetch.once("error", (err: Error) => settle.reject(err));
              fetch.once("end", () => {
                headers.sort((a, b) => b.uid - a.uid);
                settle.resolve({ headers, total });
              });
            }),
          );
        }),
      );
    },
  );
}

// Read full email

export function readEmail(
  config: EmailConfig,
  uid: number,
  mailbox: string,
  downloadDir: string | null,
  signal?: AbortSignal,
): Promise<{ parsed: ParsedMail; savedFiles: string[] }> {
  return runImap<{ parsed: ParsedMail; savedFiles: string[] }>(
    config,
    signal,
    (imap, settle) => {
      const savedFiles: string[] = [];
      let sawMessage = false;

      imap.openBox(
        mailbox,
        true,
        settle.guard((err: Error) => {
          if (err) return settle.reject(err);

          const fetch = imap.fetch(uid, { bodies: "", struct: true });

          fetch.on("message", (msg: any) => {
            sawMessage = true;
            msg.on("body", (stream: any) => {
              const chunks: Buffer[] = [];
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.once("end", async () => {
                try {
                  // Concatenate as bytes: decoding each chunk as UTF-8 in
                  // isolation corrupted multi-byte characters split across a
                  // chunk boundary.
                  const parsed = await simpleParser(Buffer.concat(chunks));

                  if (downloadDir && parsed.attachments?.length) {
                    if (!fs.existsSync(downloadDir)) {
                      fs.mkdirSync(downloadDir, { recursive: true });
                    }
                    parsed.attachments.forEach((att, index) => {
                      const name = safeAttachmentName(att.filename, index);
                      const filePath = uniquePath(
                        resolveAttachmentPath(downloadDir, name),
                      );
                      fs.writeFileSync(filePath, att.content);
                      savedFiles.push(filePath);
                    });
                  }

                  settle.resolve({ parsed, savedFiles });
                } catch (e) {
                  for (const f of savedFiles) {
                    try {
                      fs.unlinkSync(f);
                    } catch {
                      /* ignore */
                    }
                  }
                  settle.reject(e);
                }
              });
            });
          });

          fetch.once("error", (err: Error) => settle.reject(err));
          fetch.once("end", () => {
            // No message event at all means the UID does not exist. Without
            // this the promise just sat there until the timeout expired.
            if (!sawMessage) settle.reject(new EmailNotFoundError(uid, mailbox));
          });
        }),
      );
    },
  );
}

// Search

export function searchEmails(
  config: EmailConfig,
  mailbox: string,
  criteria: any[],
  limit: number,
  signal?: AbortSignal,
): Promise<{ headers: EmailHeader[]; totalResults: number }> {
  return runImap<{ headers: EmailHeader[]; totalResults: number }>(
    config,
    signal,
    (imap, settle) => {
      imap.openBox(
        mailbox,
        true,
        settle.guard((err: Error) => {
          if (err) return settle.reject(err);

          const searchCriteria = criteria.length === 0 ? ["ALL"] : criteria;

          imap.search(
            searchCriteria,
            settle.guard((err: Error, results: number[]) => {
              if (err) return settle.reject(err);
              if (results.length === 0) {
                return settle.resolve({ headers: [], totalResults: 0 });
              }

              const subset = results.slice(-normalizeLimit(limit));
              const fetch = imap.fetch(subset, {
                bodies: "HEADER.FIELDS (FROM TO CC SUBJECT DATE)",
                struct: true,
              });

              const headers: EmailHeader[] = [];
              collectHeaders(fetch, headers);

              fetch.once("error", (err: Error) => settle.reject(err));
              fetch.once("end", () => {
                headers.sort((a, b) => b.uid - a.uid);
                settle.resolve({ headers, totalResults: results.length });
              });
            }),
          );
        }),
      );
    },
  );
}

// Flags

export function setFlags(
  config: EmailConfig,
  uid: number,
  mailbox: string,
  addFlags: ReadonlyArray<string>,
  removeFlags: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<void> {
  return runImap<void>(
    config,
    signal,
    (imap, settle) => {
      imap.openBox(
        mailbox,
        false,
        settle.guard((err: Error) => {
          if (err) return settle.reject(err);

          const steps: Array<(next: () => void) => void> = [];
          if (addFlags.length > 0) {
            steps.push((next) =>
              imap.addFlags(
                uid,
                addFlags as string[],
                settle.guard((err: Error) => (err ? settle.reject(err) : next())),
              ),
            );
          }
          if (removeFlags.length > 0) {
            steps.push((next) =>
              imap.delFlags(
                uid,
                removeFlags as string[],
                settle.guard((err: Error) => (err ? settle.reject(err) : next())),
              ),
            );
          }

          // Sequential rather than parallel: node-imap serialises commands on
          // one connection anyway, and this keeps the completion condition on
          // a single path instead of a shared counter.
          const run = (index: number): void => {
            if (settle.settled) return;
            if (index >= steps.length) return settle.resolve(undefined);
            steps[index](() => run(index + 1));
          };
          run(0);
        }),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}

// Delete

export interface DeleteOutcome {
  /** True when the message was permanently removed via UID EXPUNGE. */
  readonly expunged: boolean;
}

export function deleteEmail(
  config: EmailConfig,
  uid: number,
  mailbox: string,
  signal?: AbortSignal,
): Promise<DeleteOutcome> {
  return runImap<DeleteOutcome>(
    config,
    signal,
    (imap, settle) => {
      imap.openBox(
        mailbox,
        false,
        settle.guard((err: Error) => {
          if (err) return settle.reject(err);

          imap.addFlags(
            uid,
            "\\Deleted",
            settle.guard((err: Error) => {
              if (err) return settle.reject(err);

              // A bare EXPUNGE removes *every* message flagged \Deleted in the
              // mailbox, including ones another client marked earlier. Only
              // UID EXPUNGE (RFC 4315) is scoped to this message; without
              // UIDPLUS we leave the flag set rather than risk collateral
              // deletion, and the tool reports that to the user.
              if (!imap.serverSupports("UIDPLUS")) {
                return settle.resolve({ expunged: false });
              }

              imap.expunge(
                [uid],
                settle.guard((err: Error) => {
                  if (err) return settle.reject(err);
                  settle.resolve({ expunged: true });
                }),
              );
            }),
          );
        }),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}

// Move

export function moveEmail(
  config: EmailConfig,
  uid: number,
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  return runImap<void>(
    config,
    signal,
    (imap, settle) => {
      imap.openBox(
        source,
        false,
        settle.guard((err: Error) => {
          if (err) return settle.reject(err);
          imap.move(
            uid,
            destination,
            settle.guard((err: Error) =>
              err ? settle.reject(err) : settle.resolve(undefined),
            ),
          );
        }),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}

// Append (Sent folder copies)

const SENT_MAILBOX_CANDIDATES = [
  "sent",
  "sent items",
  "sent messages",
  "sent mail",
  "inbox.sent",
  "gesendet",
  "gesendete objekte",
  "gesendete elemente",
  "[gmail]/sent mail",
];

/**
 * Pick the Sent mailbox from a flattened mailbox list.
 * Prefers the RFC 6154 \Sent special-use attribute and only falls back to
 * well-known names (English and German) when the server does not advertise it.
 */
export function pickSentMailbox(
  boxes: ReadonlyArray<{ path: string; attributes: ReadonlyArray<string> }>,
): string | null {
  const special = boxes.find((b) =>
    b.attributes.some((a) => a.toLowerCase() === "\\sent"),
  );
  if (special) return special.path;

  for (const candidate of SENT_MAILBOX_CANDIDATES) {
    const match = boxes.find((b) => b.path.toLowerCase() === candidate);
    if (match) return match.path;
  }
  return null;
}

/**
 * Append a raw RFC822 message to the Sent mailbox.
 * Returns the mailbox it was stored in, or null when none could be found.
 */
export function appendToSent(
  config: EmailConfig,
  raw: Buffer,
  signal?: AbortSignal,
): Promise<string | null> {
  return runImap<string | null>(
    config,
    signal,
    (imap, settle) => {
      const store = (mailbox: string) => {
        imap.append(
          raw,
          { mailbox, flags: ["\\Seen"] },
          settle.guard((err: Error) =>
            err ? settle.reject(err) : settle.resolve(mailbox),
          ),
        );
      };

      if (config.sentMailbox) return store(config.sentMailbox);

      imap.getBoxes(
        settle.guard((err: Error | null, boxes: Record<string, RawBox>) => {
          if (err) return settle.reject(err);
          const mailbox = pickSentMailbox(flattenMailboxes(walkBoxes(boxes)));
          if (!mailbox) return settle.resolve(null);
          store(mailbox);
        }),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}

/**
 * Append a raw RFC822 message to a drafts mailbox with the \Draft flag.
 * Used by email_draft_reply to store a reply for manual review instead of
 * sending it.
 */
export function appendDraftMessage(
  config: EmailConfig,
  draftMailbox: string,
  raw: Buffer | string,
  signal?: AbortSignal,
): Promise<void> {
  return runImap<void>(
    config,
    signal,
    (imap, settle) => {
      imap.append(
        raw,
        { mailbox: draftMailbox, flags: ["\\Draft"] },
        settle.guard((err: Error) =>
          err ? settle.reject(err) : settle.resolve(undefined),
        ),
      );
    },
    SHORT_TIMEOUT_MS,
  );
}
