/**
 * email_delete tool -- Delete an email by UID.
 */

import { Type } from "typebox";
import { deleteEmail } from "../clients/imap-client";
import { getConfigOrThrow } from "../config";
import type { DeleteParams } from "../types";

export const EmailDeleteTool = {
  name: "email_delete",
  label: "Delete Email",
  description:
    "Delete an email by UID. Marks as deleted and expunges immediately.",
  parameters: Type.Object({
    uid: Type.Number({ description: "Email UID to delete" }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: DeleteParams,
    _signal: AbortSignal,
  ) {
    const config: EmailConfig = getConfigOrThrow();
    const mailbox = params.mailbox || "INBOX";

    await deleteEmail(config, params.uid, mailbox);

    return {
      content: [
        {
          type: "text" as const,
          text: `Email UID ${params.uid} deleted from "${mailbox}".`,
        },
      ],
      details: { uid: params.uid, mailbox },
    };
  },
};
