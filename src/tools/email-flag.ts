/**
 * email_flag tool -- Set or remove flags on an email.
 *
 * Supports: Seen (read), Flagged (starred), Answered, Draft, Deleted.
 * Flags are added or removed individually.
 */

import { Type } from "typebox";
import type { MessageUid } from "../types.ts";
import { setFlags } from "../clients/mail.ts";
import { resolveConfig } from "../config.ts";

/** Convert friendly flag names to IMAP flag syntax */
export function toImapFlag(flag: string): string {
  // Already has backslash prefix => pass through
  if (flag.startsWith("\\")) return flag;
  // Common shorthands
  const aliases: Record<string, string> = {
    seen: "\\Seen",
    read: "\\Seen",
    unread: "\\Seen",
    flagged: "\\Flagged",
    starred: "\\Flagged",
    answered: "\\Answered",
    replied: "\\Answered",
    draft: "\\Draft",
    deleted: "\\Deleted",
  };
  return aliases[flag.toLowerCase()] || `\\${flag}`;
}

export const EmailFlagTool = {
  name: "email_flag",
  label: "Flag Email",
  description:
    "Set or remove IMAP flags on an email. Common flags: Seen (read/unread), Flagged (starred), Answered. Specify which flags to add or remove.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Union([Type.Number(), Type.String()], {
      description: "Email UID to flag (numeric IMAP UID, or the message id string for Microsoft Graph profiles)",
    }),
    mailbox: Type.Optional(
      Type.String({ description: "Mailbox name, defaults to INBOX" }),
    ),
    add: Type.Optional(
      Type.Array(
        Type.String({ description: "Flag to add, e.g. 'Seen', 'Flagged', 'Answered'" }),
        { description: "Flags to add" },
      ),
    ),
    remove: Type.Optional(
      Type.Array(
        Type.String({ description: "Flag to remove, e.g. 'Seen', 'Flagged'" }),
        { description: "Flags to remove" },
      ),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: {
      profile?: string;
      uid: MessageUid;
      mailbox?: string;
      add?: string[];
      remove?: string[];
    },
    signal: AbortSignal,
  ) {
    const config = resolveConfig(params.profile);
    const mailbox = params.mailbox || "INBOX";
    const addFlags = (params.add || []).map(toImapFlag);
    const removeFlags = (params.remove || []).map(toImapFlag);

    if (addFlags.length === 0 && removeFlags.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No flags specified. Use 'add' and/or 'remove' to change flags." }],
        // Same keys as the success branch: a differing details shape made the
        // tool definition fail to unify with the SDK's ToolDefinition type.
        details: { uid: params.uid, mailbox, added: [], removed: [] },
      };
    }

    await setFlags(config, params.uid, mailbox, addFlags, removeFlags, signal);

    const parts: string[] = [];
    if (addFlags.length > 0) parts.push(`added: ${addFlags.join(", ")}`);
    if (removeFlags.length > 0) parts.push(`removed: ${removeFlags.join(", ")}`);

    return {
      content: [{ type: "text" as const, text: `Email UID ${params.uid} flags updated (${parts.join("; ")}).` }],
      details: { uid: params.uid, mailbox, added: addFlags, removed: removeFlags },
    };
  },
};
