import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EmailConfig } from "../src/types.ts";
import {
  buildAuthorizeUrl,
  buildXoauth2,
  exchangeCode,
  generatePkce,
  isExpired,
  parseRedirectInput,
  redirectUriFor,
  refreshTokens,
  startCallbackServer,
  usernameFromIdToken,
  type FetchLike,
} from "../src/oauth/microsoft.ts";
import { buildMicrosoftProfile, parseLoginArgs } from "../src/commands/microsoft-login.ts";
import { allowXoauth2DespiteLoginDisabled } from "../src/clients/imap-client.ts";

const testHome = path.join(os.tmpdir(), "pi-email-oauth-test-" + process.pid);

function idToken(payload: object): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b(payload)}.sig`;
}

function fakeFetch(status: number, body: unknown, calls: any[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

describe("Microsoft OAuth helpers", () => {
  it("builds an authorize URL with PKCE and the Outlook scopes", () => {
    const { challenge } = generatePkce();
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        tenant: "organizations",
        redirectUri: redirectUriFor(1456),
        challenge,
        state: "st",
        loginHint: "a@b.de",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:1456");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("login_hint"), "a@b.de");
    const scope = url.searchParams.get("scope")!;
    assert.match(scope, /offline_access/);
    assert.match(scope, /IMAP\.AccessAsUser\.All/);
    assert.match(scope, /SMTP\.Send/);
  });

  it("parses pasted redirect URLs, query strings and bare codes", () => {
    assert.deepEqual(parseRedirectInput("http://localhost:1456/?code=abc&state=xyz"), {
      code: "abc",
      state: "xyz",
      error: undefined,
    });
    assert.equal(parseRedirectInput("?code=abc&state=xyz").code, "abc");
    assert.deepEqual(parseRedirectInput("  rawcode "), { code: "rawcode" });
    assert.match(parseRedirectInput("http://localhost/?error=access_denied&error_description=nope").error!, /access_denied/);
    assert.deepEqual(parseRedirectInput(""), {});
  });

  it("reads the username from the id_token", () => {
    assert.equal(usernameFromIdToken(idToken({ preferred_username: "pat@firma.de" })), "pat@firma.de");
    assert.equal(usernameFromIdToken("garbage"), undefined);
    assert.equal(usernameFromIdToken(undefined), undefined);
  });

  it("encodes the SASL XOAUTH2 string", () => {
    const decoded = Buffer.from(buildXoauth2("u@x.de", "TOKEN"), "base64").toString();
    assert.equal(decoded, "user=u@x.de\x01auth=Bearer TOKEN\x01\x01");
  });

  it("treats tokens close to expiry as expired", () => {
    const now = 1_000_000_000;
    assert.equal(isExpired(undefined, now), true);
    assert.equal(isExpired(now + 60_000, now), true);
    assert.equal(isExpired(now + 3_600_000, now), false);
  });

  it("exchanges the code and returns tokens", async () => {
    const calls: any[] = [];
    const tokens = await exchangeCode({
      fetchFn: fakeFetch(200, {
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3600,
        id_token: idToken({ preferred_username: "pat@firma.de" }),
      }, calls),
      clientId: "cid",
      tenant: "contoso.com",
      code: "c",
      verifier: "v",
      redirectUri: "http://localhost:1456",
      now: 0,
    });
    assert.deepEqual(tokens, { accessToken: "AT", refreshToken: "RT", expiresAt: 3_600_000, username: "pat@firma.de" });
    assert.equal(calls[0].url, "https://login.microsoftonline.com/contoso.com/oauth2/v2.0/token");
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code_verifier"), "v");
  });

  it("keeps the old refresh token when none is returned", async () => {
    const tokens = await refreshTokens({
      fetchFn: fakeFetch(200, { access_token: "AT2", expires_in: 60 }),
      clientId: "cid",
      tenant: "organizations",
      refreshToken: "OLD",
      now: 0,
    });
    assert.equal(tokens.refreshToken, "OLD");
  });

  it("surfaces the error description on failure", async () => {
    await assert.rejects(
      refreshTokens({
        fetchFn: fakeFetch(400, { error: "invalid_grant", error_description: "AADSTS70008: expired" }),
        clientId: "cid",
        tenant: "organizations",
        refreshToken: "OLD",
      }),
      /AADSTS70008/,
    );
  });
});

describe("loopback callback server", () => {
  it("accepts the code with the right state", async () => {
    const port = 18000 + (process.pid % 1000);
    const srv = await startCallbackServer({ port, host: "127.0.0.1", state: "s1" });
    try {
      const bad = await fetch(`http://127.0.0.1:${port}/?code=x&state=wrong`);
      assert.equal(bad.status, 400);
      const ok = await fetch(`http://127.0.0.1:${port}/?code=thecode&state=s1`);
      assert.equal(ok.status, 200);
      assert.equal(await srv.waitForCode(), "thecode");
    } finally {
      srv.close();
    }
  });

  it("rejects when Microsoft returns an error", async () => {
    const port = 19000 + (process.pid % 1000);
    const srv = await startCallbackServer({ port, host: "127.0.0.1", state: "s2" });
    try {
      const wait = srv.waitForCode();
      await fetch(`http://127.0.0.1:${port}/?error=access_denied&error_description=denied&state=s2`);
      await assert.rejects(wait, /access_denied/);
    } finally {
      srv.close();
    }
  });

  it("resolves null when cancelled", async () => {
    const port = 20000 + (process.pid % 1000);
    const srv = await startCallbackServer({ port, host: "127.0.0.1", state: "s3" });
    srv.cancel();
    assert.equal(await srv.waitForCode(), null);
    srv.close();
  });
});

describe("/email-login-microsoft helpers", () => {
  it("parses profile and email in any order", () => {
    assert.deepEqual(parseLoginArgs("work pat@firma.de"), { profile: "work", email: "pat@firma.de" });
    assert.deepEqual(parseLoginArgs("pat@firma.de"), { profile: undefined, email: "pat@firma.de" });
    assert.deepEqual(parseLoginArgs(""), { profile: undefined, email: undefined });
  });

  it("builds an Exchange Online profile and keeps user settings", () => {
    const cfg = buildMicrosoftProfile({
      email: "pat@firma.de",
      clientId: "cid",
      tenant: "organizations",
      refreshToken: "RT",
      accessToken: "AT",
      expiresAt: 1,
      existing: { fromName: "Pat", sentMailbox: "Gesendete Elemente" } as EmailConfig,
    });
    assert.equal(cfg.imap.host, "outlook.office365.com");
    assert.equal(cfg.smtp.host, "smtp.office365.com");
    assert.equal(cfg.smtp.port, 587);
    assert.equal(cfg.fromName, "Pat");
    assert.equal(cfg.sentMailbox, "Gesendete Elemente");
    assert.equal(cfg.appendToSent, false);
    assert.equal(cfg.oauth?.refreshToken, "RT");
  });
});

describe("getAccessToken", () => {
  let config: typeof import("../src/config.ts");
  let tokens: typeof import("../src/oauth/tokens.ts");
  const origHome = process.env.HOME;

  before(async () => {
    process.env.HOME = testHome;
    config = await import("../src/config.ts");
    tokens = await import("../src/oauth/tokens.ts");
  });

  after(() => {
    process.env.HOME = origHome;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  const base: EmailConfig = buildMicrosoftProfile({
    email: "pat@firma.de",
    clientId: "cid",
    tenant: "organizations",
    refreshToken: "RT1",
    accessToken: "AT1",
    expiresAt: 0,
  });

  it("returns a valid stored token without refreshing", async () => {
    config._resetForTesting();
    const cfg = { ...base, oauth: { ...base.oauth!, expiresAt: Date.now() + 3_600_000 } };
    let refreshed = 0;
    const token = await tokens.getAccessToken(cfg, async () => {
      refreshed++;
      throw new Error("should not refresh");
    });
    assert.equal(token, "AT1");
    assert.equal(refreshed, 0);
  });

  it("refreshes once for concurrent callers and persists rotated tokens", async () => {
    config._resetForTesting();
    config.saveProfile("work", base);
    const stored = config.getProfile("work")!;
    let refreshed = 0;
    const refresher = async () => {
      refreshed++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: "AT2", refreshToken: "RT2", expiresAt: Date.now() + 3_600_000 };
    };
    const [a, b] = await Promise.all([
      tokens.getAccessToken(stored, refresher),
      tokens.getAccessToken(stored, refresher),
    ]);
    assert.equal(a, "AT2");
    assert.equal(b, "AT2");
    assert.equal(refreshed, 1);
    assert.equal(config.getProfile("work")!.oauth!.refreshToken, "RT2");
    const onDisk = JSON.parse(fs.readFileSync(path.join(testHome, ".pi", "email-config.json"), "utf8"));
    assert.equal(onDisk.profiles.work.oauth.accessToken, "AT2");
  });

  it("tells the user to log in again when refresh fails", async () => {
    config._resetForTesting();
    await assert.rejects(
      tokens.getAccessToken(base, async () => {
        throw new Error("invalid_grant");
      }),
      /email-login-microsoft/,
    );
  });
});

describe("allowXoauth2DespiteLoginDisabled", () => {
  it("hides LOGINDISABLED but keeps other capabilities", () => {
    const caps = new Set(["LOGINDISABLED", "AUTH=XOAUTH2", "IDLE"]);
    const fake: any = { serverSupports: (c: string) => caps.has(c) };
    allowXoauth2DespiteLoginDisabled(fake);
    assert.equal(fake.serverSupports("LOGINDISABLED"), false);
    assert.equal(fake.serverSupports("AUTH=XOAUTH2"), true);
    assert.equal(fake.serverSupports("MOVE"), false);
  });
});
