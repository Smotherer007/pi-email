/**
 * email_flag tool -- Set or remove flags on an email.
 *
 * Supports: Seen (read), Flagged (starred), Answered, Draft, Deleted.
 * Flags are added or removed individually.
 */

import { Type } from "typebox";
import { connectImap } from "../clients/imap-client";
import type { EmailConfig } from "../types";
import { resolveConfig } from "../config";

export const EmailFlagTool = {
  name: "email_flag",
  label: "Flag Email",
  description:
    "Set or remove IMAP flags on an email. Common flags: Seen (read/unread), Flagged (starred), Answered. Specify which flags to add or remove.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "Profile name to use. Uses active profile if omitted." }),
    ),
    uid: Type.Number({ description: "Email UID to flag" }),
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
      uid: number;
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
        details: { uid: params.uid, mailbox },
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

/** Convert friendly flag names to IMAP flag syntax */
function toImapFlag(flag: string): string {
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

function setFlags(
  config: EmailConfig,
  uid: number,
  mailbox: string,
  addFlags: string[],
  removeFlags: string[],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const timeoutSignal = signal ?? AbortSignal.timeout(30_000);
    let resolved = false;

    if (timeoutSignal.aborted) {
      return reject(new DOMException("Operation timed out", "TimeoutError"));
    }
    timeoutSignal.addEventListener("abort", () => {
      if (!resolved) {
        resolved = true;
        reject(new DOMException("Operation timed out", "TimeoutError"));
      }
    }, { once: true });

    const imap = await connectImap(config);

    imap.openBox(mailbox, false, (err: Error) => {
      if (err) {
        if (!resolved) resolved = true;
        imap.end();
        return reject(err);
      }

      let pending = 0;
      const done = () => {
        if (--pending === 0) {
          imap.end();
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }
      };

      if (addFlags.length > 0) {
        pending++;
        imap.addFlags(uid, addFlags, (err: Error) => {
          if (err && !resolved) {
            resolved = true;
            imap.end();
            return reject(err);
          }
          done();
        });
      }

      if (removeFlags.length > 0) {
        pending++;
        imap.delFlags(uid, removeFlags, (err: Error) => {
          if (err && !resolved) {
            resolved = true;
            imap.end();
            return reject(err);
          }
          done();
        });
      }

      if (pending === 0) {
        imap.end();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }
    });
  });
}
