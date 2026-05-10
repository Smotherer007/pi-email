/**
 * pi Email Client Extension
 *
 * Provides email capabilities via IMAP (read) and SMTP (send).
 *
 * Tools:
 *   - email_list_mailboxes: List available IMAP folders
 *   - email_fetch: Fetch emails from a mailbox
 *   - email_read: Read a specific email by UID
 *   - email_search: Search emails with IMAP criteria
 *   - email_send: Send an email via SMTP
 *   - email_delete: Delete an email
 *   - email_move: Move an email to another mailbox
 *   - email_status: Show connection status and config
 *   - email_setup: Configure email account credentials
 *
 * Data-oriented design:
 *   - All domain data is represented as plain immutable interfaces (types.ts)
 *   - I/O is isolated in client modules (clients/)
 *   - Pure formatting functions convert data to display strings (formatting/)
 *   - Each tool is a single-responsibility module (tools/)
 *   - Configuration is managed as mutable state with file persistence (config.ts)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig, getConfig } from "./src/config";
import { EmailSetupTool } from "./src/tools/email-setup";
import { EmailListMailboxesTool } from "./src/tools/email-list-mailboxes";
import { EmailFetchTool } from "./src/tools/email-fetch";
import { EmailReadTool } from "./src/tools/email-read";
import { EmailSearchTool } from "./src/tools/email-search";
import { EmailSendTool } from "./src/tools/email-send";
import { EmailDeleteTool } from "./src/tools/email-delete";
import { EmailMoveTool } from "./src/tools/email-move";
import { EmailStatusTool } from "./src/tools/email-status";

export default function (pi: ExtensionAPI) {
  // Load saved config on startup
  loadConfig();

  // Register all tools
  pi.registerTool(EmailSetupTool);
  pi.registerTool(EmailStatusTool);
  pi.registerTool(EmailListMailboxesTool);
  pi.registerTool(EmailFetchTool);
  pi.registerTool(EmailReadTool);
  pi.registerTool(EmailSearchTool);
  pi.registerTool(EmailSendTool);
  pi.registerTool(EmailDeleteTool);
  pi.registerTool(EmailMoveTool);

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
