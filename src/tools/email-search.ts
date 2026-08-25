/**
 * email_search tool -- Search emails with IMAP criteria.
 */

import { Type } from "typebox";
import { searchEmails } from "../clients/imap-client.ts";
import { resolveConfig } from "../config.ts";
import { formatSearchResults } from "../formatting/formatters.ts";
import type { SearchParams } from "../types.ts";

/**
 * Validate a YYYY-MM-DD date and return it as a Date.
 *
 * node-imap builds the SEARCH command synchronously inside its own callback,
 * so an unparseable date threw an exception that no promise could catch and
 * that terminated the host process. Rejecting it here keeps it a normal,
 * explainable tool error.
 */
export function parseSearchDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(
      `Invalid ${field} date "${value}". Use the format YYYY-MM-DD, e.g. 2026-01-31.`,
    );
  }
  const parsed = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field} date "${value}". No such calendar date.`);
  }
  return parsed;
}

export const EmailSearchTool = {
  name: "email_search",
  label: "Search Emails",
  description:
    "Search emails using IMAP criteria. Specify one or more of: from, subject, body, since (YYYY-MM-DD), before (YYYY-MM-DD), unseen flag.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
    from: Type.Optional(Type.String({ description: "Search sender" })),
    subject: Type.Optional(Type.String({ description: "Search subject line" })),
    body: Type.Optional(Type.String({ description: "Search body text" })),
    since: Type.Optional(
      Type.String({ description: "Emails since date (YYYY-MM-DD)" }),
    ),
    before: Type.Optional(
      Type.String({ description: "Emails before date (YYYY-MM-DD)" }),
    ),
    unseen: Type.Optional(Type.Boolean({ description: "Only unread emails" })),
    limit: Type.Optional(
      Type.Number({ description: "Max results, default 20" }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: SearchParams,
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";
    const limit = params.limit || 20;

    const criteria: any[] = [];
    if (params.unseen) criteria.push("UNSEEN");
    if (params.from) criteria.push(["FROM", params.from]);
    if (params.subject) criteria.push(["SUBJECT", params.subject]);
    if (params.body) criteria.push(["BODY", params.body]);
    if (params.since) criteria.push(["SINCE", parseSearchDate(params.since, "since")]);
    if (params.before) criteria.push(["BEFORE", parseSearchDate(params.before, "before")]);

    const { headers, totalResults } = await searchEmails(
      config,
      mailbox,
      criteria,
      limit,
      signal,
    );
    const text = formatSearchResults(headers, totalResults);

    return {
      content: [{ type: "text" as const, text }],
      details: { count: headers.length, totalResults, mailbox },
    };
  },
};
