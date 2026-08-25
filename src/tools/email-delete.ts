/**
 * email_delete tool -- Delete an email by UID.
 */

import { Type } from "typebox";
import { deleteEmail } from "../clients/imap-client.ts";
import { resolveConfig } from "../config.ts";
import type { DeleteParams } from "../types.ts";

export const EmailDeleteTool = {
  name: "email_delete",
  label: "Delete Email",
  description:
    "Delete an email by UID. Marks it as deleted and removes it permanently when the server supports UID EXPUNGE (RFC 4315); otherwise it stays flagged as deleted so no other message is affected. Consider email_move to a Trash folder instead, which is reversible.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to delete" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: DeleteParams,
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";

    const { expunged } = await deleteEmail(config, params.uid, mailbox, signal);

    const text = expunged
      ? `Email UID ${params.uid} permanently deleted from "${mailbox}".`
      : `Email UID ${params.uid} marked as deleted in "${mailbox}". The server does not support UID EXPUNGE, so it was not expunged -- it disappears when the mailbox is next expunged by your mail client.`;

    return {
      content: [{ type: "text" as const, text }],
      details: { uid: params.uid, mailbox, expunged },
    };
  },
};
