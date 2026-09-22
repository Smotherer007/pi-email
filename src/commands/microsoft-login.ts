/**
 * /email-login-microsoft -- Sign in a Microsoft 365 work/school account.
 *
 * Interactive command (not a tool) on purpose: the user completes the login
 * in a browser, and tokens never pass through the model.
 *
 * Usage: /email-login-microsoft [profile] [email]
 *
 * Environment:
 *   PI_EMAIL_MS_CLIENT_ID   Entra ID application (client) id
 *   PI_EMAIL_MS_TENANT      tenant, default "organizations"
 *   PI_EMAIL_OAUTH_PORT     loopback callback port, default 1456
 *   PI_OAUTH_CALLBACK_HOST  callback bind address, default 127.0.0.1
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getProfile, saveProfile, setActiveProfile } from "../config.ts";
import type { EmailConfig } from "../types.ts";
import {
  DEFAULT_CALLBACK_HOST,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_TENANT,
  MICROSOFT_IMAP_HOST,
  MICROSOFT_SMTP_HOST,
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  generateState,
  parseRedirectInput,
  redirectUriFor,
  startCallbackServer,
} from "../oauth/microsoft.ts";

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const WIDGET_KEY = "pi-email-login";

export function parseLoginArgs(args: string): { profile?: string; email?: string } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const email = parts.find((p) => p.includes("@"));
  const profile = parts.find((p) => !p.includes("@"));
  return { profile, email };
}

/** Build the profile for a Microsoft account, keeping user settings of an existing one. */
export function buildMicrosoftProfile(opts: {
  email: string;
  clientId: string;
  tenant: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  existing?: EmailConfig | null;
}): EmailConfig {
  const existing = opts.existing;
  return {
    imap: {
      host: MICROSOFT_IMAP_HOST,
      port: 993,
      tls: true,
      user: opts.email,
      password: "",
    },
    smtp: {
      host: MICROSOFT_SMTP_HOST,
      port: 587,
      secure: false,
      user: opts.email,
      password: "",
    },
    ...(existing?.fromName !== undefined && { fromName: existing.fromName }),
    // Exchange Online files SMTP submissions in "Sent Items" itself.
    appendToSent: existing?.appendToSent ?? false,
    ...(existing?.sentMailbox !== undefined && { sentMailbox: existing.sentMailbox }),
    oauth: {
      provider: "microsoft",
      clientId: opts.clientId,
      tenant: opts.tenant,
      refreshToken: opts.refreshToken,
      accessToken: opts.accessToken,
      expiresAt: opts.expiresAt,
    },
  };
}

async function ask(
  ctx: ExtensionCommandContext,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  const value = await ctx.ui.input(title, placeholder);
  return value?.trim() || undefined;
}

export async function microsoftLoginHandler(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parsed = parseLoginArgs(args);
  const profileName =
    parsed.profile ?? (await ask(ctx, "Profile name for this account", "work")) ?? "work";
  const existing = getProfile(profileName);

  const clientId =
    process.env.PI_EMAIL_MS_CLIENT_ID?.trim() ||
    existing?.oauth?.clientId ||
    (await ask(ctx, "Entra ID application (client) ID", "00000000-0000-0000-0000-000000000000"));
  if (!clientId) {
    ctx.ui.notify(
      "No client ID. Set PI_EMAIL_MS_CLIENT_ID or enter the app registration's client ID (see README).",
      "error",
    );
    return;
  }
  const tenant =
    process.env.PI_EMAIL_MS_TENANT?.trim() || existing?.oauth?.tenant || DEFAULT_TENANT;
  const port = Number(process.env.PI_EMAIL_OAUTH_PORT) || DEFAULT_CALLBACK_PORT;
  const host = process.env.PI_OAUTH_CALLBACK_HOST?.trim() || DEFAULT_CALLBACK_HOST;
  const loginHint = parsed.email ?? existing?.imap.user;

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const redirectUri = redirectUriFor(port);
  const url = buildAuthorizeUrl({ clientId, tenant, redirectUri, challenge, state, loginHint });

  let server;
  try {
    server = await startCallbackServer({ port, host, state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(
      `Could not listen on ${host}:${port} (${msg}). Set PI_EMAIL_OAUTH_PORT to a free port.`,
      "error",
    );
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, [
    "Microsoft login -- open this URL in your browser:",
    url,
    "",
    `pi on a remote machine? Forward the callback port first, from your local machine:`,
    `  ssh -L ${port}:127.0.0.1:${port} <user>@<host>`,
    "Without a tunnel: after login copy the address of the (failed) localhost page and paste it below.",
  ]);

  const pasteAbort = new AbortController();
  const timeout = setTimeout(() => server.cancel(), LOGIN_TIMEOUT_MS);
  let pasted: string | undefined;
  const pastePromise = ctx.hasUI
    ? ctx.ui
        .input("Paste the redirect URL (only if the browser did not reach pi)", redirectUri, {
          signal: pasteAbort.signal,
        })
        .then((v) => {
          pasted = v?.trim() || undefined;
          if (pasted) server.cancel();
        })
        .catch(() => undefined)
    : Promise.resolve();

  try {
    let code = await server.waitForCode();
    if (!code && pasted) {
      const input = parseRedirectInput(pasted);
      if (input.error) throw new Error(`Microsoft login failed: ${input.error}`);
      if (input.state && input.state !== state) throw new Error("State mismatch -- start the login again.");
      code = input.code ?? null;
    }
    if (!code) {
      ctx.ui.notify("Microsoft login cancelled or timed out.", "warning");
      return;
    }

    const tokens = await exchangeCode({ clientId, tenant, code, verifier, redirectUri });
    const email =
      tokens.username ?? parsed.email ?? existing?.imap.user ?? (await ask(ctx, "Email address"));
    if (!email) throw new Error("Could not determine the account's email address.");

    saveProfile(
      profileName,
      buildMicrosoftProfile({
        email,
        clientId,
        tenant,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
        existing,
      }),
    );
    setActiveProfile(profileName);
    ctx.ui.notify(`Signed in as ${email}. Profile "${profileName}" is active.`, "info");
  } catch (err) {
    ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
  } finally {
    clearTimeout(timeout);
    pasteAbort.abort();
    await pastePromise;
    server.close();
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
}
