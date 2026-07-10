/**
 * email_status tool -- Show current email configuration status.
 *
 * Lists all configured profiles and highlights the active one.
 */

import { Type } from "typebox";
import { getProfiles, getActiveProfile } from "../config.ts";
import { formatProfileStatus } from "../formatting/formatters.ts";

export const EmailStatusTool = {
  name: "email_status",
  label: "Email Status",
  description:
    "Show current email configuration status (which account is configured).",
  parameters: Type.Object({}),

  execute(_toolCallId: string, _params: {}, _signal: AbortSignal) {
    const allProfiles = getProfiles();
    const active = getActiveProfile();
    const text = formatProfileStatus(allProfiles, active);

    return {
      content: [{ type: "text" as const, text }],
      details: {
        configured: Object.keys(allProfiles).length > 0,
        profileCount: Object.keys(allProfiles).length,
        activeProfile: active,
        profiles: Object.keys(allProfiles),
      },
    };
  },
};
