/**
 * email_list_mailboxes tool -- List available IMAP folders.
 */

import { Type } from "typebox";
import { listMailboxes } from "../clients/imap-client.ts";
import { resolveConfig } from "../config.ts";
import { formatMailboxList } from "../formatting/formatters.ts";

export const EmailListMailboxesTool = {
  name: "email_list_mailboxes",
  label: "List Mailboxes",
  description: "List all available IMAP mailboxes/folders.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string },
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const boxes = await listMailboxes(config, signal);
    const text = formatMailboxList(boxes);

    return {
      content: [{ type: "text" as const, text }],
      details: { mailboxCount: boxes.length },
    };
  },
};
