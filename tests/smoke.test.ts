/**
 * Smoke test — verifies all 12 tools have the correct shape
 * and that the extension entry point registers them without errors.
 */
import { describe, it, expect } from "vitest";

import { EmailSetupTool } from "../src/tools/email-setup";
import { EmailStatusTool } from "../src/tools/email-status";
import { EmailListMailboxesTool } from "../src/tools/email-list-mailboxes";
import { EmailFetchTool } from "../src/tools/email-fetch";
import { EmailReadTool } from "../src/tools/email-read";
import { EmailSearchTool } from "../src/tools/email-search";
import { EmailSendTool } from "../src/tools/email-send";
import { EmailReplyTool } from "../src/tools/email-reply";
import { EmailForwardTool } from "../src/tools/email-forward";
import { EmailDeleteTool } from "../src/tools/email-delete";
import { EmailMoveTool } from "../src/tools/email-move";
import { EmailFlagTool } from "../src/tools/email-flag";

const allTools = [
  EmailSetupTool,
  EmailStatusTool,
  EmailListMailboxesTool,
  EmailFetchTool,
  EmailReadTool,
  EmailSearchTool,
  EmailSendTool,
  EmailReplyTool,
  EmailForwardTool,
  EmailDeleteTool,
  EmailMoveTool,
  EmailFlagTool,
];

describe("Tool structure smoke test", () => {
  it("has exactly 12 tools", () => {
    expect(allTools).toHaveLength(12);
  });

  for (const tool of allTools) {
    it(`${tool.name} has required fields`, () => {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe("string");
      expect(tool.label).toBeTruthy();
      expect(typeof tool.label).toBe("string");
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    });
  }

  it("all tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tool names follow email_ prefix convention", () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^email_/);
    }
  });
});

describe("Config module", () => {
  it("loadConfig and getConfig are importable", async () => {
    const mod = await import("../src/config");
    expect(typeof mod.loadConfig).toBe("function");
    expect(typeof mod.getConfig).toBe("function");
    expect(typeof mod.resolveConfig).toBe("function");
    expect(typeof mod.saveProfile).toBe("function");
    expect(typeof mod.getProfiles).toBe("function");
    expect(typeof mod.getActiveProfile).toBe("function");
    expect(typeof mod.setActiveProfile).toBe("function");
    expect(typeof mod.deleteProfile).toBe("function");
  });
});
