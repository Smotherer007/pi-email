/**
 * email_move tool -- Move an email to another mailbox.
 */

import { Type } from "typebox";
import { moveEmail } from "../clients/imap-client";
import { resolveConfig } from "../config";
import type { MoveParams } from "../types";

export const EmailMoveTool = {
  name: "email_move",
  label: "Move Email",
  description: "Move an email to another mailbox/folder.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to move" }),
    destination: Type.String({ description: "Destination mailbox name" }),
    source: Type.Optional(
      Type.String({ description: "Source mailbox, defaults to INBOX" }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: MoveParams,
    _signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const source = params.source || "INBOX";

    await moveEmail(config, params.uid, source, params.destination);

    return {
      content: [
        {
          type: "text" as const,
          text: `Email UID ${params.uid} moved from "${source}" to "${params.destination}".`,
        },
      ],
      details: { uid: params.uid, source, destination: params.destination },
    };
  },
};
