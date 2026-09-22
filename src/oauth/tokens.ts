/**
 * Access-token resolution for OAuth profiles.
 *
 * Returns the stored access token while it is valid, otherwise refreshes it
 * and persists the rotated tokens. Concurrent callers for the same account
 * share one refresh, so parallel tool calls do not race and invalidate each
 * other's refresh token.
 */

// Namespace import: tool tests mock config.ts with only the functions they
// use, and a named import of a missing export would fail at link time.
import * as configStore from "../config.ts";
import type { EmailConfig } from "../types.ts";
import {
  isExpired,
  refreshTokens,
  type MicrosoftApi,
  type MicrosoftTokens,
} from "./microsoft.ts";

type Refresher = (opts: {
  clientId: string;
  tenant: string;
  refreshToken: string;
  api?: MicrosoftApi;
}) => Promise<MicrosoftTokens>;

const inflight = new Map<string, Promise<string>>();

export async function getAccessToken(
  config: EmailConfig,
  refresher: Refresher = refreshTokens,
  now: number = Date.now(),
): Promise<string> {
  const oauth = config.oauth;
  if (!oauth) throw new Error("Profile is not configured for OAuth");
  if (oauth.accessToken && !isExpired(oauth.expiresAt, now)) {
    return oauth.accessToken;
  }

  const key = `${oauth.provider}|${oauth.api ?? "outlook"}|${oauth.clientId}|${config.imap.user}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const refresh = (async () => {
    try {
      const tokens = await refresher({
        clientId: oauth.clientId,
        tenant: oauth.tenant,
        refreshToken: oauth.refreshToken,
        api: oauth.api ?? "outlook",
      });
      configStore.updateOAuthTokens(config, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      return tokens.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${msg}\nThe Microsoft login for ${config.imap.user} could not be refreshed. ` +
          `Run /email-login-microsoft again to sign in.`,
      );
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, refresh);
  return refresh;
}
