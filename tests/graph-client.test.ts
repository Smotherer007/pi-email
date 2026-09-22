import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { EmailConfig } from "../src/types.ts";
import * as graph from "../src/clients/graph-client.ts";
import { deliverEmail } from "../src/delivery.ts";
import * as mail from "../src/clients/mail.ts";

const config: EmailConfig = {
  imap: { host: "graph.microsoft.com", port: 443, tls: true, user: "neo@firma.de", password: "" },
  smtp: { host: "graph.microsoft.com", port: 443, secure: true, user: "neo@firma.de", password: "" },
  fromName: "Neo",
  appendToSent: false,
  oauth: {
    provider: "microsoft",
    api: "graph",
    clientId: "cid",
    tenant: "organizations",
    refreshToken: "RT",
    accessToken: "AT",
    expiresAt: Date.now() + 3_600_000,
  },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

let calls: Call[] = [];
type Route = (call: Call) => { status?: number; json?: unknown; text?: string } | undefined;
let routes: Route[] = [];

function install(): void {
  graph._setFetchForTesting((async (input: any, init: any) => {
    const call: Call = {
      url: decodeURIComponent(String(input)),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    for (const route of routes) {
      const r = route(call);
      if (r) {
        const status = r.status ?? 200;
        const payload = r.text ?? (r.json === undefined ? "" : JSON.stringify(r.json));
        return new Response(status === 204 || status === 202 ? null : payload, { status });
      }
    }
    return new Response(JSON.stringify({ error: { code: "ErrorItemNotFound", message: "nope" } }), { status: 404 });
  }) as typeof fetch);
}

beforeEach(() => {
  calls = [];
  routes = [];
  install();
});
after(() => graph._setFetchForTesting(null));

const message = {
  id: "AAMk-immutable-1",
  subject: "Angebot",
  from: { emailAddress: { name: "Kunde", address: "kunde@x.de" } },
  toRecipients: [{ emailAddress: { name: "Neo", address: "neo@firma.de" } }],
  ccRecipients: [],
  bccRecipients: [],
  receivedDateTime: "2026-09-20T08:00:00Z",
  isRead: false,
  isDraft: false,
  flag: { flagStatus: "flagged" },
};

describe("graph fetchHeaders", () => {
  it("fetches the newest messages of a well-known folder with immutable ids", async () => {
    routes.push((c) => (c.url.includes("/me/mailFolders/inbox?$select=totalItemCount") ? { json: { totalItemCount: 42 } } : undefined));
    routes.push((c) => (c.url.includes("/me/mailFolders/inbox/messages") ? { json: { value: [message] } } : undefined));
    const { headers, total } = await graph.fetchHeaders(config, "INBOX", 10, false);
    assert.equal(total, 42);
    assert.deepEqual(headers[0], {
      uid: "AAMk-immutable-1",
      from: "Kunde <kunde@x.de>",
      to: "Neo <neo@firma.de>",
      cc: "",
      bcc: "",
      subject: "Angebot",
      date: "2026-09-20T08:00:00Z",
      flags: ["\\Flagged"],
    });
    const list = calls.find((c) => c.url.includes("/messages"))!;
    assert.match(list.url, /\$top=10/);
    assert.match(list.url, /\$orderby=receivedDateTime desc/);
    assert.equal(list.headers.Authorization, "Bearer AT");
    assert.equal(list.headers.Prefer, 'IdType="ImmutableId"');
  });

  it("filters unread messages with an orderby-compatible filter", async () => {
    routes.push((c) => (c.url.includes("totalItemCount") ? { json: { totalItemCount: 1 } } : undefined));
    routes.push((c) => (c.url.includes("/messages") ? { json: { value: [] } } : undefined));
    await graph.fetchHeaders(config, "Posteingang", 5, true);
    const list = calls.find((c) => c.url.includes("/messages"))!;
    assert.match(list.url, /\$filter=receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false/);
  });
});

describe("graph folders", () => {
  function folderRoutes(): void {
    routes.push((c) => (c.url.endsWith("/me/mailFolders/inbox?$select=id") ? { json: { id: "ID-INBOX" } } : undefined));
    routes.push((c) => (c.url.endsWith("/me/mailFolders/sentitems?$select=id") ? { json: { id: "ID-SENT" } } : undefined));
    routes.push((c) =>
      c.url.includes("/me/mailFolders?$select")
        ? {
            json: {
              value: [
                { id: "ID-INBOX", displayName: "Posteingang", childFolderCount: 1 },
                { id: "ID-SENT", displayName: "Gesendete Elemente", childFolderCount: 0 },
              ],
            },
          }
        : undefined,
    );
    routes.push((c) =>
      c.url.includes("/me/mailFolders/ID-INBOX/childFolders")
        ? { json: { value: [{ id: "ID-KUNDEN", displayName: "Kunden", childFolderCount: 0 }] } }
        : undefined,
    );
  }

  it("lists the folder tree with paths and special-use attributes", async () => {
    folderRoutes();
    const boxes = await graph.listMailboxes(config);
    assert.equal(boxes[0].path, "Posteingang");
    assert.equal(boxes[0].children[0].path, "Posteingang/Kunden");
    assert.deepEqual(boxes[1].attributes, ["\\Sent"]);
  });

  it("resolves INBOX/Kunden to the child folder id when moving", async () => {
    folderRoutes();
    routes.push((c) => (c.url.includes("/move") ? { json: { id: "x" } } : undefined));
    await graph.moveEmail(config, "AAMk-immutable-1", "INBOX", "INBOX/Kunden");
    const move = calls.find((c) => c.url.includes("/move"))!;
    assert.equal(move.method, "POST");
    assert.deepEqual(JSON.parse(move.body!), { destinationId: "ID-KUNDEN" });
  });

  it("lists available folders when a mailbox does not exist", async () => {
    folderRoutes();
    await assert.rejects(graph.moveEmail(config, "AAMk-1", "INBOX", "Gibtsnicht"), /Posteingang\/Kunden/);
  });
});

describe("graph messages", () => {
  it("reads a message from its MIME source", async () => {
    const mime = "From: Kunde <kunde@x.de>\r\nTo: neo@firma.de\r\nSubject: Hallo\r\nMessage-ID: <m1@x.de>\r\n\r\nText\r\n";
    routes.push((c) => (c.url.endsWith("/me/messages/AAMk-immutable-1/$value") ? { text: mime } : undefined));
    const { parsed, savedFiles } = await graph.readEmail(config, "AAMk-immutable-1", "INBOX", null);
    assert.equal(parsed.subject, "Hallo");
    assert.equal(parsed.messageId, "<m1@x.de>");
    assert.deepEqual(savedFiles, []);
  });

  it("maps a missing message to EmailNotFoundError and rejects IMAP UIDs", async () => {
    await assert.rejects(graph.readEmail(config, "AAMk-gone", "INBOX", null), { name: "EmailNotFoundError" });
    await assert.rejects(graph.readEmail(config, 42, "INBOX", null), /IMAP UID/);
  });

  it("maps Seen/Flagged to a PATCH and refuses other flags", async () => {
    routes.push((c) => (c.method === "PATCH" ? { json: {} } : undefined));
    await graph.setFlags(config, "AAMk-1", "INBOX", ["\\Seen"], ["\\Flagged"]);
    assert.deepEqual(JSON.parse(calls[0].body!), { isRead: true, flag: { flagStatus: "notFlagged" } });
    await assert.rejects(graph.setFlags(config, "AAMk-1", "INBOX", ["\\Answered"], []), /not supported/);
  });

  it("deletes into Deleted Items", async () => {
    routes.push((c) => (c.method === "DELETE" ? { status: 204 } : undefined));
    const outcome = await graph.deleteEmail(config, "AAMk-1", "INBOX");
    assert.deepEqual(outcome, { expunged: false, movedTo: "Deleted Items" });
  });

  it("adds a permission hint to 403 errors", async () => {
    routes.push(() => ({ status: 403, json: { error: { code: "ErrorAccessDenied", message: "Access is denied." } } }));
    await assert.rejects(graph.fetchHeaders(config, "INBOX", 1, false), /Mail\.ReadWrite/);
  });
});

describe("graph sending", () => {
  it("sends the composed MIME via sendMail, keeping Bcc, without a Sent copy", async () => {
    routes.push((c) => (c.url.endsWith("/me/sendMail") ? { status: 202 } : undefined));
    const { result, sentCopy } = await deliverEmail(config, {
      to: "kunde@x.de",
      bcc: "archiv@firma.de",
      subject: "Test",
      body: "Hallo",
    });
    assert.equal(result.to, "kunde@x.de");
    assert.equal(sentCopy.status, "skipped");
    const send = calls.find((c) => c.url.endsWith("/me/sendMail"))!;
    assert.equal(send.headers["Content-Type"], "text/plain");
    const mime = Buffer.from(send.body!, "base64").toString();
    assert.match(mime, /^Bcc: archiv@firma\.de/m);
    assert.match(mime, /^Subject: Test/m);
    assert.match(mime, /^From: Neo <neo@firma\.de>/m);
  });

  it("creates drafts from MIME", async () => {
    routes.push((c) => (c.url.endsWith("/me/messages") && c.method === "POST" ? { json: { id: "D1" } } : undefined));
    await graph.appendDraftMessage(config, "Drafts", "Subject: x\r\n\r\nbody");
    assert.equal(calls.length, 1);
    assert.equal(Buffer.from(calls[0].body!, "base64").toString(), "Subject: x\r\n\r\nbody");
  });
});

describe("buildSearchQuery", () => {
  it("uses $search for text criteria and filters unseen locally", () => {
    const { query, unseenLocally } = graph.buildSearchQuery(
      ["UNSEEN", ["FROM", "kunde@x.de"], ["SUBJECT", "Angebot 2026"], ["SINCE", new Date("2026-09-01T00:00:00Z")]],
      20,
    );
    assert.equal(unseenLocally, true);
    const decoded = decodeURIComponent(query);
    assert.match(decoded, /\$search="from:kunde@x\.de subject:\\"Angebot 2026\\" received>=2026-09-01"/);
    assert.doesNotMatch(decoded, /\$orderby/);
  });

  it("uses $filter with ordering for date/unseen-only searches", () => {
    const { query, unseenLocally } = graph.buildSearchQuery(["UNSEEN", ["BEFORE", new Date("2026-09-10T00:00:00Z")]], 5);
    assert.equal(unseenLocally, false);
    assert.match(
      decodeURIComponent(query),
      /\$filter=receivedDateTime ge 1900-01-01T00:00:00Z and receivedDateTime lt 2026-09-10T00:00:00\.000Z and isRead eq false/,
    );
  });
});

describe("mail dispatch", () => {
  it("rejects non-numeric UIDs for IMAP profiles", async () => {
    const imapConfig: EmailConfig = { ...config, oauth: undefined };
    assert.throws(() => mail.readEmail(imapConfig, "abc", "INBOX", null), /numeric UID/);
  });

  it("routes Graph profiles to Graph", async () => {
    routes.push((c) => (c.method === "DELETE" ? { status: 204 } : undefined));
    const outcome = await mail.deleteEmail(config, "AAMk-1", "INBOX");
    assert.equal(outcome.movedTo, "Deleted Items");
  });
});
