/**
 * Microsoft 365 / Exchange Online OAuth2 (authorization code + PKCE).
 *
 * Exchange Online no longer accepts passwords over IMAP for work and school
 * accounts, and SMTP AUTH with a password is being switched off as well, so
 * those accounts need XOAUTH2. The login uses the loopback redirect that
 * native apps are expected to use: a tiny HTTP server on 127.0.0.1 receives
 * the redirect. When pi runs on a remote machine the user forwards that port
 * over SSH (`ssh -L <port>:127.0.0.1:<port> host`), or pastes the final
 * redirect URL back into pi if forwarding is not possible.
 *
 * Everything here apart from the callback server is pure or takes `fetch`
 * as a parameter, so the protocol can be tested without the network.
 */

import * as crypto from "node:crypto";
import * as http from "node:http";

export const MICROSOFT_IMAP_HOST = "outlook.office365.com";
export const MICROSOFT_SMTP_HOST = "smtp.office365.com";

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
] as const;

/** Default tenant: any work or school account. */
export const DEFAULT_TENANT = "organizations";
export const DEFAULT_CALLBACK_PORT = 1456;
export const DEFAULT_CALLBACK_HOST = "127.0.0.1";

/** Refresh this long before the access token actually expires. */
const EXPIRY_SKEW_MS = 5 * 60_000;

export interface MicrosoftTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** Account name from the id_token (usually the email address), if present. */
  readonly username?: string;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

// PKCE / URLs

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Entra ID ignores the port of `http://localhost` redirect URIs for public
 * clients, so one registered `http://localhost` covers any callback port.
 */
export function redirectUriFor(port: number): string {
  return `http://localhost:${port}`;
}

function authorityBase(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  tenant: string;
  redirectUri: string;
  challenge: string;
  state: string;
  loginHint?: string;
}): string {
  const url = new URL(`${authorityBase(opts.tenant)}/authorize`);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("prompt", "select_account");
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

/**
 * Accept what a user pastes after a failed redirect: the full redirect URL,
 * just its query string, or the bare code.
 */
export function parseRedirectInput(input: string): {
  code?: string;
  state?: string;
  error?: string;
} {
  const value = input.trim();
  if (!value) return {};
  let params: URLSearchParams | null = null;
  try {
    params = new URL(value).searchParams;
  } catch {
    if (value.includes("code=") || value.includes("error=")) {
      params = new URLSearchParams(value.replace(/^[?#]/, ""));
    }
  }
  if (!params) return { code: value };
  const error = params.get("error");
  return {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: error ? `${error}: ${params.get("error_description") ?? ""}`.trim() : undefined,
  };
}

// Token endpoint

export function usernameFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const name = payload.preferred_username ?? payload.email ?? payload.upn;
    return typeof name === "string" && name ? name : undefined;
  } catch {
    return undefined;
  }
}

async function tokenRequest(
  fetchFn: FetchLike,
  tenant: string,
  body: Record<string, string>,
  previousRefreshToken: string | undefined,
  now: number,
  signal?: AbortSignal,
): Promise<MicrosoftTokens> {
  const res = await fetchFn(`${authorityBase(tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.error_description || json.error || text;
    } catch {
      /* not JSON */
    }
    throw new Error(`Microsoft token request failed (${res.status}): ${detail}`);
  }
  const json = await res.json();
  if (!json?.access_token || typeof json.expires_in !== "number") {
    throw new Error("Microsoft token response is missing access_token/expires_in");
  }
  // Microsoft rotates refresh tokens, but may omit a new one on refresh.
  const refreshToken = json.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Microsoft did not return a refresh token (offline_access missing?)");
  }
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: now + json.expires_in * 1000,
    username: usernameFromIdToken(json.id_token),
  };
}

export function exchangeCode(opts: {
  fetchFn?: FetchLike;
  clientId: string;
  tenant: string;
  code: string;
  verifier: string;
  redirectUri: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<MicrosoftTokens> {
  return tokenRequest(
    opts.fetchFn ?? (fetch as unknown as FetchLike),
    opts.tenant,
    {
      client_id: opts.clientId,
      grant_type: "authorization_code",
      code: opts.code,
      code_verifier: opts.verifier,
      redirect_uri: opts.redirectUri,
      scope: MICROSOFT_SCOPES.join(" "),
    },
    undefined,
    opts.now ?? Date.now(),
    opts.signal,
  );
}

export function refreshTokens(opts: {
  fetchFn?: FetchLike;
  clientId: string;
  tenant: string;
  refreshToken: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<MicrosoftTokens> {
  return tokenRequest(
    opts.fetchFn ?? (fetch as unknown as FetchLike),
    opts.tenant,
    {
      client_id: opts.clientId,
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      scope: MICROSOFT_SCOPES.join(" "),
    },
    opts.refreshToken,
    opts.now ?? Date.now(),
    opts.signal,
  );
}

export function isExpired(expiresAt: number | undefined, now: number = Date.now()): boolean {
  return !expiresAt || expiresAt - EXPIRY_SKEW_MS <= now;
}

/** SASL XOAUTH2 initial response, base64-encoded as node-imap expects it. */
export function buildXoauth2(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`, "utf8").toString("base64");
}

// Loopback callback server

export interface CallbackServer {
  /** Resolves with the code, or null when cancelled. Rejects on a provider error. */
  waitForCode(): Promise<string | null>;
  cancel(): void;
  close(): void;
}

function page(title: string, message: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">` +
    `<h2>${esc(title)}</h2><p>${esc(message)}</p></body>`;
}

export function startCallbackServer(opts: {
  port: number;
  host: string;
  state: string;
}): Promise<CallbackServer> {
  let settle: ((v: string | null) => void) | undefined;
  let fail: ((e: Error) => void) | undefined;
  const codePromise = new Promise<string | null>((resolve, reject) => {
    let done = false;
    settle = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    fail = (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    };
  });

  // A provider error can arrive before anyone awaits waitForCode(); keep
  // that from surfacing as an unhandled rejection. Consumers still see it.
  codePromise.catch(() => undefined);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!error && !code) {
      res.statusCode = 404;
      res.end(page("Not found", "This is the pi-email login callback."));
      return;
    }
    if (url.searchParams.get("state") !== opts.state) {
      res.statusCode = 400;
      res.end(page("Login failed", "State mismatch. Please start the login again."));
      return;
    }
    if (error) {
      const desc = url.searchParams.get("error_description") ?? "";
      res.statusCode = 400;
      res.end(page("Login failed", `${error}: ${desc}`));
      fail?.(new Error(`Microsoft login failed: ${error} ${desc}`.trim()));
      return;
    }
    res.statusCode = 200;
    res.end(page("Login successful", "pi-email is now connected. You can close this tab."));
    settle?.(code);
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(opts.port, opts.host, () => {
      resolve({
        waitForCode: () => codePromise,
        cancel: () => settle?.(null),
        close: () => {
          settle?.(null);
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}
