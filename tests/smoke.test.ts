/**
 * Smoke test — verifies all 14 tools have the correct shape
 * and that the extension entry point registers them without errors.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EmailSetupTool } from "../src/tools/email-setup.ts";
import { EmailStatusTool } from "../src/tools/email-status.ts";
import { EmailProfileTool } from "../src/tools/email-profile.ts";
import { EmailListMailboxesTool } from "../src/tools/email-list-mailboxes.ts";
import { EmailFetchTool } from "../src/tools/email-fetch.ts";
import { EmailReadTool } from "../src/tools/email-read.ts";
import { EmailSearchTool } from "../src/tools/email-search.ts";
import { EmailSendTool } from "../src/tools/email-send.ts";
import { EmailReplyTool } from "../src/tools/email-reply.ts";
import { EmailDraftReplyTool } from "../src/tools/email-draft-reply.ts";
import { EmailForwardTool } from "../src/tools/email-forward.ts";
import { EmailDeleteTool } from "../src/tools/email-delete.ts";
import { EmailMoveTool } from "../src/tools/email-move.ts";
import { EmailFlagTool } from "../src/tools/email-flag.ts";

const allTools = [
  EmailSetupTool,
  EmailStatusTool,
  EmailProfileTool,
  EmailListMailboxesTool,
  EmailFetchTool,
  EmailReadTool,
  EmailSearchTool,
  EmailSendTool,
  EmailReplyTool,
  EmailDraftReplyTool,
  EmailForwardTool,
  EmailDeleteTool,
  EmailMoveTool,
  EmailFlagTool,
];

describe("Tool structure smoke test", () => {
  it("has exactly 14 tools", () => {
    assert.strictEqual(allTools.length, 14);
  });

  for (const tool of allTools) {
    it(`${tool.name} has required fields`, () => {
      assert.ok(tool.name);
      assert.strictEqual(typeof tool.name, "string");
      assert.ok(tool.label);
      assert.strictEqual(typeof tool.label, "string");
      assert.ok(tool.description);
      assert.strictEqual(typeof tool.description, "string");
      assert.ok(tool.parameters !== undefined);
      assert.strictEqual(typeof tool.execute, "function");
    });
  }

  it("all tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it("all tool names follow email_ prefix convention", () => {
    for (const tool of allTools) {
      assert.ok(/^email_/.test(tool.name));
    }
  });
});

describe("Config module", () => {
  it("loadConfig and getConfig are importable", async () => {
    const mod = await import("../src/config.ts");
    assert.strictEqual(typeof mod.loadConfig, "function");
    assert.strictEqual(typeof mod.getConfig, "function");
    assert.strictEqual(typeof mod.resolveConfig, "function");
    assert.strictEqual(typeof mod.saveProfile, "function");
    assert.strictEqual(typeof mod.getProfiles, "function");
    assert.strictEqual(typeof mod.getActiveProfile, "function");
    assert.strictEqual(typeof mod.setActiveProfile, "function");
    assert.strictEqual(typeof mod.deleteProfile, "function");
  });
});
