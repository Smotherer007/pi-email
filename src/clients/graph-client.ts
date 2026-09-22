/**
 * Microsoft Graph mail backend.
 *
 * Used for Microsoft 365 profiles where IMAP and SMTP AUTH are switched off
 * (common in company tenants). Mirrors the IMAP client's operations and data
 * shapes so the tools do not need to know which backend they talk to:
 *
 *   - Message ids are Graph *immutable* ids (strings), so they survive moves.
 *   - Messages are read as raw MIME (`$value`) and go through the same parser
 *     and attachment handling as IMAP messages.
 *   - Messages are sent and drafts created from the same composed MIME as
 *     SMTP, so threading headers, attachments and sender rules are shared.
 *   - Mailboxes are addressed by path ("Posteingang/Kunden"), by well-known
 *     aliases ("INBOX", "Sent", "Drafts", "Trash", ...) or by folder id.
 */

import { simpleParser, type ParsedMail } from "mailparser";
import type { EmailConfig, EmailHeader, MailboxInfo, MessageUid, SendParams } from "../types.ts";
import { EmailNotFoundError } from "../types.ts";
import { getAccessToken } from "../oauth/tokens.ts";
// Namespace imports: tool tests mock these modules with a subset of their
// exports, and named imports of absent exports would fail at link time.
import * as imapClient from "./imap-client.ts";
import * as smtpClient from "./smtp-client.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/** Graph rejects MIME uploads above 4 MB (base64-encoded). */
const MAX_MIME_UPLOAD = 4 * 1024 * 1024;
const MAX_PAGE = 1000;

export function isGraphProfile(config: EmailConfig): boolean {
  return config.oauth?.provider === "microsoft" && config.oauth.api === "graph";
}

// HTTP

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);

/** @internal for tests */
export function _setFetchForTesting(fn: FetchFn | null): void {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

export class GraphError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

interface GraphRequest {
  readonly method?: string;
  readonly json?: unknown;
  /** Raw request body, e.g. base64 MIME. */
  readonly text?: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

function hintFor(status: number, code: string): string {
  if (status === 401) {
    return " The Microsoft login is no longer valid; run /email-login-microsoft again.";
  }
  if (status === 403 || code === "ErrorAccessDenied") {
    return " The app needs the delegated Graph permissions Mail.ReadWrite and Mail.Send (with admin consent where required).";
  }
  return "";
}

async function graphResponse(
  config: EmailConfig,
  path: string,
  req: GraphRequest = {},
): Promise<Response> {
  const method = req.method ?? "GET";
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`;

  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(config);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Prefer: 'IdType="ImmutableId"',
      ...req.headers,
    };
    let body: string | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.text !== undefined) {
      headers["Content-Type"] = "text/plain";
      body = req.text;
    }

    const res = await fetchImpl(url, { method, headers, body, signal: req.signal });
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.ok) return res;

    const text = await res.text().catch(() => "");
    let code = "";
    let message = text || res.statusText;
    try {
      const err = JSON.parse(text)?.error;
      if (err) {
        code = err.code ?? "";
        message = err.message ?? message;
      }
    } catch {
      /* not JSON */
    }
    throw new GraphError(
      res.status,
      code,
      `Microsoft Graph ${method} ${path.split("?")[0]} failed (${res.status}${code ? ` ${code}` : ""}): ${message}.${hintFor(res.status, code)}`,
    );
  }
}

async function graphJson<T = any>(config: EmailConfig, path: string, req: GraphRequest = {}): Promise<T> {
  const res = await graphResponse(config, path, req);
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function graphPaged<T = any>(config: EmailConfig, path: string, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: any = await graphJson(config, next, { signal });
    out.push(...(page?.value ?? []));
    next = page?.["@odata.nextLink"];
  }
  return out;
}

function messageId(uid: MessageUid): string {
  if (typeof uid === "number" || /^\d+$/.test(String(uid))) {
    throw new Error(
      `"${uid}" looks like an IMAP UID, but this profile uses Microsoft Graph. Use the message id shown by email_fetch or email_search.`,
    );
  }
  return encodeURIComponent(String(uid));
}

// Folders

/** Mailbox names that map to Graph well-known folders (English and German). */
const WELL_KNOWN_ALIASES: Record<string, string> = {
  inbox: "inbox",
  posteingang: "inbox",
  sent: "sentitems",
  "sent items": "sentitems",
  "sent mail": "sentitems",
  "sent messages": "sentitems",
  sentitems: "sentitems",
  gesendet: "sentitems",
  "gesendete elemente": "sentitems",
  "gesendete objekte": "sentitems",
  drafts: "drafts",
  draft: "drafts",
  "entwürfe": "drafts",
  entwuerfe: "drafts",
  trash: "deleteditems",
  deleted: "deleteditems",
  "deleted items": "deleteditems",
  deleteditems: "deleteditems",
  papierkorb: "deleteditems",
  "gelöschte elemente": "deleteditems",
  "geloeschte elemente": "deleteditems",
  junk: "junkemail",
  spam: "junkemail",
  "junk email": "junkemail",
  "junk e-mail": "junkemail",
  junkemail: "junkemail",
  "junk-e-mail": "junkemail",
  archive: "archive",
  archiv: "archive",
  outbox: "outbox",
  postausgang: "outbox",
};

const SPECIAL_USE: Record<string, string> = {
  sentitems: "\\Sent",
  drafts: "\\Drafts",
  deleteditems: "\\Trash",
  junkemail: "\\Junk",
  archive: "\\Archive",
};

export function wellKnownAlias(name: string): string | undefined {
  return WELL_KNOWN_ALIASES[name.trim().toLowerCase()];
}

interface FolderNode {
  readonly id: string;
  readonly displayName: string;
  readonly path: string;
  readonly wellKnown?: string;
  readonly children: FolderNode[];
}

const FOLDER_SELECT = "$select=id,displayName,childFolderCount&$top=250";

async function wellKnownIds(config: EmailConfig, signal?: AbortSignal): Promise<Map<string, string>> {
  const names = ["inbox", ...Object.keys(SPECIAL_USE), "outbox"];
  const ids = new Map<string, string>();
  await Promise.all(
    names.map(async (name) => {
      try {
        const folder: any = await graphJson(config, `/me/mailFolders/${name}?$select=id`, { signal });
        if (folder?.id) ids.set(folder.id, name);
      } catch {
        /* not every mailbox has every well-known folder (e.g. archive) */
      }
    }),
  );
  return ids;
}

async function loadFolderTree(config: EmailConfig, signal?: AbortSignal): Promise<FolderNode[]> {
  const known = await wellKnownIds(config, signal);
  const walk = async (listPath: string, prefix: string): Promise<FolderNode[]> => {
    const raw = await graphPaged<any>(config, listPath, signal);
    return Promise.all(
      raw.map(async (f) => {
        const path = prefix + f.displayName;
        return {
          id: f.id,
          displayName: f.displayName,
          path,
          wellKnown: known.get(f.id),
          children:
            f.childFolderCount > 0
              ? await walk(`/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?${FOLDER_SELECT}`, path + "/")
              : [],
        };
      }),
    );
  };
  return walk(`/me/mailFolders?${FOLDER_SELECT}`, "");
}

function toMailboxInfo(node: FolderNode): MailboxInfo {
  const special = node.wellKnown ? SPECIAL_USE[node.wellKnown] : undefined;
  return {
    name: node.displayName,
    selectable: true,
    path: node.path,
    attributes: special ? [special] : [],
    children: node.children.map(toMailboxInfo),
  };
}

/** Find a folder by path; each segment matches a display name or a well-known alias. */
export function findFolder(tree: ReadonlyArray<FolderNode>, mailbox: string): FolderNode | null {
  const segments = mailbox.split("/").map((s) => s.trim()).filter(Boolean);
  let level: ReadonlyArray<FolderNode> = tree;
  let found: FolderNode | null = null;
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const alias = wellKnownAlias(segment);
    found =
      level.find((f) => f.displayName.toLowerCase() === lower) ??
      (alias ? level.find((f) => f.wellKnown === alias) : undefined) ??
      null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

function flatten(tree: ReadonlyArray<FolderNode>): FolderNode[] {
  return tree.flatMap((f) => [f, ...flatten(f.children)]);
}

/** Resolve a mailbox name to something usable in /me/mailFolders/{...}. */
async function resolveFolder(config: EmailConfig, mailbox: string, signal?: AbortSignal): Promise<string> {
  const name = mailbox.trim() || "INBOX";
  const alias = wellKnownAlias(name);
  if (alias) return alias;

  const tree = await loadFolderTree(config, signal);
  const byPath = findFolder(tree, name);
  if (byPath) return encodeURIComponent(byPath.id);

  const all = flatten(tree);
  const byId = all.find((f) => f.id === name);
  if (byId) return encodeURIComponent(byId.id);
  const byName = all.filter((f) => f.displayName.toLowerCase() === name.toLowerCase());
  if (byName.length === 1) return encodeURIComponent(byName[0].id);

  throw new Error(
    `Mailbox "${mailbox}" not found. Available: ${all.map((f) => f.path).join(", ")}`,
  );
}

export async function listMailboxes(config: EmailConfig, signal?: AbortSignal): Promise<ReadonlyArray<MailboxInfo>> {
  const tree = await loadFolderTree(config, signal);
  return tree.map(toMailboxInfo);
}

// Messages

const MESSAGE_SELECT =
  "$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,isDraft,flag";

function formatAddress(r: any): string {
  const name = r?.emailAddress?.name;
  const address = r?.emailAddress?.address ?? "";
  return name && name !== address ? `${name} <${address}>` : address;
}

function formatAddresses(list: any): string {
  return Array.isArray(list) ? list.map(formatAddress).filter(Boolean).join(", ") : "";
}

export function toHeader(m: any): EmailHeader {
  const flags: string[] = [];
  if (m.isRead) flags.push("\\Seen");
  if (m.flag?.flagStatus === "flagged") flags.push("\\Flagged");
  if (m.isDraft) flags.push("\\Draft");
  return {
    uid: m.id,
    from: m.from ? formatAddress(m.from) : "",
    to: formatAddresses(m.toRecipients),
    cc: formatAddresses(m.ccRecipients),
    bcc: formatAddresses(m.bccRecipients),
    subject: m.subject ?? "",
    date: m.receivedDateTime ?? "",
    flags,
  };
}

function pageSize(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), MAX_PAGE);
}

export async function fetchHeaders(
  config: EmailConfig,
  mailbox: string,
  limit: number,
  unseen: boolean,
  signal?: AbortSignal,
): Promise<{ headers: EmailHeader[]; total: number }> {
  const folder = await resolveFolder(config, mailbox, signal);
  const info: any = await graphJson(config, `/me/mailFolders/${folder}?$select=totalItemCount`, { signal });
  // Graph only allows $orderby together with $filter when the ordered
  // property is also the first filter clause.
  const filter = unseen
    ? `&$filter=${encodeURIComponent("receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false")}`
    : "";
  const page: any = await graphJson(
    config,
    `/me/mailFolders/${folder}/messages?${MESSAGE_SELECT}&$top=${pageSize(limit)}&$orderby=receivedDateTime%20desc${filter}`,
    { signal },
  );
  return { headers: (page?.value ?? []).map(toHeader), total: info?.totalItemCount ?? 0 };
}

function kqlTerm(field: string, value: string): string {
  const clean = value.replace(/["\\]/g, " ").trim();
  return /\s/.test(clean) ? `${field}:\\"${clean}\\"` : `${field}:${clean}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Translate the IMAP-style criteria built by email_search. Text criteria
 * need Graph's $search (KQL), which cannot be combined with $filter or
 * $orderby, so "unseen" is then applied to the returned page.
 */
export function buildSearchQuery(criteria: ReadonlyArray<any>, limit: number): {
  query: string;
  unseenLocally: boolean;
} {
  let unseen = false;
  const kql: string[] = [];
  const filters: string[] = [];
  for (const c of criteria) {
    if (c === "UNSEEN") {
      unseen = true;
      continue;
    }
    if (!Array.isArray(c)) continue;
    const [key, value] = c;
    if (key === "FROM") kql.push(kqlTerm("from", String(value)));
    else if (key === "SUBJECT") kql.push(kqlTerm("subject", String(value)));
    else if (key === "BODY") kql.push(kqlTerm("body", String(value)));
    else if (key === "SINCE") {
      kql.push(`received>=${isoDay(value)}`);
      filters.push(`receivedDateTime ge ${value.toISOString()}`);
    } else if (key === "BEFORE") {
      kql.push(`received<${isoDay(value)}`);
      filters.push(`receivedDateTime lt ${value.toISOString()}`);
    }
  }

  const top = `$top=${pageSize(limit)}`;
  if (kql.some((k) => !k.startsWith("received"))) {
    return {
      query: `${MESSAGE_SELECT}&${top}&$search=${encodeURIComponent(`"${kql.join(" ")}"`)}`,
      unseenLocally: unseen,
    };
  }
  if (!filters.some((f) => f.startsWith("receivedDateTime ge"))) {
    filters.unshift("receivedDateTime ge 1900-01-01T00:00:00Z");
  }
  if (unseen) filters.push("isRead eq false");
  return {
    query: `${MESSAGE_SELECT}&${top}&$count=true&$orderby=receivedDateTime%20desc&$filter=${encodeURIComponent(filters.join(" and "))}`,
    unseenLocally: false,
  };
}

export async function searchEmails(
  config: EmailConfig,
  mailbox: string,
  criteria: any[],
  limit: number,
  signal?: AbortSignal,
): Promise<{ headers: EmailHeader[]; totalResults: number }> {
  const folder = await resolveFolder(config, mailbox, signal);
  const { query, unseenLocally } = buildSearchQuery(criteria, limit);
  const page: any = await graphJson(config, `/me/mailFolders/${folder}/messages?${query}`, {
    signal,
    headers: { ConsistencyLevel: "eventual" },
  });
  let messages: any[] = page?.value ?? [];
  if (unseenLocally) messages = messages.filter((m) => !m.isRead);
  const headers = messages.map(toHeader);
  const count = page?.["@odata.count"];
  return {
    headers,
    totalResults: typeof count === "number" && !unseenLocally ? count : headers.length,
  };
}

export async function readEmail(
  config: EmailConfig,
  uid: MessageUid,
  mailbox: string,
  downloadDir: string | null,
  signal?: AbortSignal,
): Promise<{ parsed: ParsedMail; savedFiles: string[] }> {
  let res: Response;
  try {
    res = await graphResponse(config, `/me/messages/${messageId(uid)}/$value`, { signal });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) throw new EmailNotFoundError(uid, mailbox);
    throw err;
  }
  const parsed = await simpleParser(Buffer.from(await res.arrayBuffer()));
  const savedFiles = imapClient.saveAttachments(parsed, downloadDir);
  return { parsed, savedFiles };
}

export async function setFlags(
  config: EmailConfig,
  uid: MessageUid,
  _mailbox: string,
  addFlags: ReadonlyArray<string>,
  removeFlags: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const apply = (flag: string, on: boolean) => {
    const f = flag.toLowerCase();
    if (f === "\\seen") patch.isRead = on;
    else if (f === "\\flagged") patch.flag = { flagStatus: on ? "flagged" : "notFlagged" };
    else {
      throw new Error(
        `Flag ${flag} is not supported for Microsoft Graph profiles (only Seen and Flagged). Use email_delete to delete a message.`,
      );
    }
  };
  addFlags.forEach((f) => apply(f, true));
  removeFlags.forEach((f) => apply(f, false));
  if (Object.keys(patch).length === 0) return;
  await graphJson(config, `/me/messages/${messageId(uid)}`, { method: "PATCH", json: patch, signal });
}

export async function deleteEmail(
  config: EmailConfig,
  uid: MessageUid,
  mailbox: string,
  signal?: AbortSignal,
): Promise<{ expunged: boolean; movedTo?: string }> {
  try {
    // Graph's DELETE moves the message to Deleted Items; it stays recoverable.
    await graphJson(config, `/me/messages/${messageId(uid)}`, { method: "DELETE", signal });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) throw new EmailNotFoundError(uid, mailbox);
    throw err;
  }
  return { expunged: false, movedTo: "Deleted Items" };
}

export async function moveEmail(
  config: EmailConfig,
  uid: MessageUid,
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const destinationId = decodeURIComponent(await resolveFolder(config, destination, signal));
  try {
    await graphJson(config, `/me/messages/${messageId(uid)}/move`, {
      method: "POST",
      json: { destinationId },
      signal,
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) throw new EmailNotFoundError(uid, source);
    throw err;
  }
}

function mimeBody(raw: Buffer | string): string {
  const b64 = Buffer.from(raw).toString("base64");
  if (b64.length > MAX_MIME_UPLOAD) {
    throw new Error(
      `Message is too large for Microsoft Graph (${Math.round(b64.length / 1024 / 1024)} MB encoded, limit 4 MB). Send fewer or smaller attachments.`,
    );
  }
  return b64;
}

export async function appendDraftMessage(
  config: EmailConfig,
  draftMailbox: string,
  raw: Buffer | string,
  signal?: AbortSignal,
): Promise<void> {
  // A message created from MIME lands in Drafts as a draft.
  const created: any = await graphJson(config, "/me/messages", {
    method: "POST",
    text: mimeBody(raw),
    signal,
  });
  if (wellKnownAlias(draftMailbox || "Drafts") !== "drafts" && created?.id) {
    const destinationId = decodeURIComponent(await resolveFolder(config, draftMailbox, signal));
    await graphJson(config, `/me/messages/${encodeURIComponent(created.id)}/move`, {
      method: "POST",
      json: { destinationId },
      signal,
    });
  }
}

/** Send via Graph. Exchange files the message in Sent Items itself. */
export async function sendEmail(
  config: EmailConfig,
  params: SendParams | smtpClient.SendOptions,
  signal?: AbortSignal,
): Promise<{ messageId: string; to: string; subject: string; raw: Buffer }> {
  const built = await smtpClient.composeMessage(config, params, { keepBcc: true });
  await graphJson(config, "/me/sendMail", { method: "POST", text: mimeBody(built.raw), signal });
  return { messageId: built.messageId, to: params.to, subject: params.subject, raw: built.raw };
}
