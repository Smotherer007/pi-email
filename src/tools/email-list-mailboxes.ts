/**
 * email_list_mailboxes tool -- List available IMAP folders.
 */

import { Type } from "typebox";
import { listMailboxes } from "../clients/imap-client";
import { getConfigOrThrow } from "../config";
import { formatMailboxList } from "../formatting/formatters";


export const EmailListMailboxesTool = {
  name: "email_list_mailboxes",
  label: "List Mailboxes",
  description: "List all available IMAP mailboxes/folders.",
  parameters: Type.Object({}),

  async execute(_toolCallId: string, _params: {}, _signal: AbortSignal) {
    const config: EmailConfig = getConfigOrThrow();
    const boxes = await listMailboxes(config);
    const text = formatMailboxList(boxes);

    return {
      content: [{ type: "text" as const, text }],
      details: { mailboxCount: boxes.length },
    };
  },
};
