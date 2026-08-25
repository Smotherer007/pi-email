/**
 * pi Email Client Extension
 *
 * Provides email capabilities via IMAP (read) and SMTP (send).
 *
 * Tools:
 *   - email_setup: Configure email account credentials
 *   - email_status: Show connection status and config
 *   - email_profile: List, switch or delete email profiles
 *   - email_list_mailboxes: List available IMAP folders
 *   - email_fetch: Fetch emails from a mailbox
 *   - email_read: Read a specific email by UID
 *   - email_search: Search emails with IMAP criteria
 *   - email_send: Send an email via SMTP
 *   - email_reply: Reply to an email with threading headers
 *   - email_forward: Forward an email to new recipients
 *   - email_delete: Delete an email
 *   - email_move: Move an email to another mailbox
 *   - email_flag: Set or remove IMAP flags (read/unread/flagged)
 *
 * Data-oriented design:
 *   - All domain data is represented as plain immutable interfaces (types.ts)
 *   - I/O is isolated in client modules (clients/)
 *   - Pure formatting functions convert data to display strings (formatting/)
 *   - Each tool is a single-responsibility module (tools/)
 *   - Configuration is managed as mutable state with file persistence (config.ts)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig, getConfig } from "./src/config.ts";
import { EmailSetupTool } from "./src/tools/email-setup.ts";
import { EmailListMailboxesTool } from "./src/tools/email-list-mailboxes.ts";
import { EmailFetchTool } from "./src/tools/email-fetch.ts";
import { EmailReadTool } from "./src/tools/email-read.ts";
import { EmailSearchTool } from "./src/tools/email-search.ts";
import { EmailSendTool } from "./src/tools/email-send.ts";
import { EmailReplyTool } from "./src/tools/email-reply.ts";
import { EmailForwardTool } from "./src/tools/email-forward.ts";
import { EmailDeleteTool } from "./src/tools/email-delete.ts";
import { EmailMoveTool } from "./src/tools/email-move.ts";
import { EmailFlagTool } from "./src/tools/email-flag.ts";
import { EmailStatusTool } from "./src/tools/email-status.ts";
import { EmailProfileTool } from "./src/tools/email-profile.ts";

export default function (pi: ExtensionAPI) {
  // Load saved config on startup
  loadConfig();

  // Register all tools
  pi.registerTool(EmailSetupTool);
  pi.registerTool(EmailStatusTool);
  pi.registerTool(EmailProfileTool);
  pi.registerTool(EmailListMailboxesTool);
  pi.registerTool(EmailFetchTool);
  pi.registerTool(EmailReadTool);
  pi.registerTool(EmailSearchTool);
  pi.registerTool(EmailSendTool);
  pi.registerTool(EmailReplyTool);
  pi.registerTool(EmailForwardTool);
  pi.registerTool(EmailDeleteTool);
  pi.registerTool(EmailMoveTool);
  pi.registerTool(EmailFlagTool);

  // Register a shortcut to quickly check inbox
  pi.registerCommand("inbox", {
    description: "Quickly fetch recent inbox emails",
    handler: async (_args, ctx) => {
      if (!getConfig()) {
        ctx.ui.notify(
          "Email not configured. Use email_setup tool first.",
          "error",
        );
        return;
      }
      pi.sendUserMessage(
        "Please use email_fetch to show me my recent inbox emails (last 10).",
        { deliverAs: "steer" },
      );
      ctx.ui.notify("Asking agent to fetch inbox...", "info");
    },
  });
}
