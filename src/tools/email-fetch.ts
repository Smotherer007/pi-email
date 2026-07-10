/**
 * email_fetch tool -- Fetch email headers from a mailbox.
 */

import { Type } from "typebox";
import { fetchHeaders } from "../clients/imap-client.ts";
import { resolveConfig } from "../config.ts";
import { formatHeaderList } from "../formatting/formatters.ts";
import type { FetchParams } from "../types.ts";

export const EmailFetchTool = {
  name: "email_fetch",
  label: "Fetch Emails",
  description:
    "Fetch a list of emails from a mailbox with optional limit. Returns headers (uid, from, subject, date, flags) for each email. Use email_read to get the full body.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max number of emails to fetch, default 20" }),
    ),
    unseen: Type.Optional(
      Type.Boolean({ description: "Fetch only unread emails", default: false }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: FetchParams,
    _signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";
    const limit = params.limit || 20;
    const unseen = params.unseen || false;

    const { headers, total } = await fetchHeaders(
      config,
      mailbox,
      limit,
      unseen,
      _signal,
    );
    const text = formatHeaderList(headers, mailbox, total);

    return {
      content: [{ type: "text" as const, text }],
      details: { count: headers.length, total, mailbox },
    };
  },
};
