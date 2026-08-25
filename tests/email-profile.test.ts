import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

let EmailProfileTool: any;
let mockGetProfiles: any;
let mockGetActiveProfile: any;
let mockSetActiveProfile: any;
let mockDeleteProfile: any;

const workProfile = {
  imap: { host: "imap.work.com", port: 993, tls: true, user: "me@work.com", password: "pw" },
  smtp: { host: "smtp.work.com", port: 587, secure: false, user: "me@work.com", password: "pw" },
  fromName: "Work Me",
};
const personalProfile = {
  imap: { host: "imap.personal.com", port: 993, tls: true, user: "me@personal.com", password: "pw" },
  smtp: { host: "smtp.personal.com", port: 587, secure: false, user: "me@personal.com", password: "pw" },
};

before(async () => {
  mockGetProfiles = mock.fn(() => ({ work: workProfile, personal: personalProfile }));
  mockGetActiveProfile = mock.fn(() => "work");
  mockSetActiveProfile = mock.fn();
  mockDeleteProfile = mock.fn(() => true);

  mock.module("../src/config.ts", {
    exports: {
      getProfiles: mockGetProfiles,
      getActiveProfile: mockGetActiveProfile,
      setActiveProfile: mockSetActiveProfile,
      deleteProfile: mockDeleteProfile,
    },
  });

  ({ EmailProfileTool } = await import("../src/tools/email-profile.ts"));
});

describe("EmailProfileTool", () => {
  it("has correct tool name", () => {
    assert.strictEqual(EmailProfileTool.name, "email_profile");
  });

  it("lists profiles by default", async () => {
    const result = await EmailProfileTool.execute(
      "call-1",
      {},
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("2 email profiles configured"));
    assert.ok(result.content[0].text.includes("me@work.com"));
    assert.ok(result.content[0].text.includes("[active]"));
  });

  it("lists profiles with explicit list action", async () => {
    const result = await EmailProfileTool.execute(
      "call-1",
      { action: "list" },
      new AbortController().signal,
    );
    assert.ok(result.content[0].text.includes("me@personal.com"));
    assert.strictEqual(result.details.activeProfile, "work");
  });

  it("switches the active profile", async () => {
    mockSetActiveProfile.mock.resetCalls();

    const result = await EmailProfileTool.execute(
      "call-1",
      { action: "use", name: "personal" },
      new AbortController().signal,
    );
    assert.strictEqual(mockSetActiveProfile.mock.callCount(), 1);
    assert.strictEqual(mockSetActiveProfile.mock.calls[0].arguments[0], "personal");
    assert.ok(result.content[0].text.includes('"personal"'));
  });

  it("deletes a profile", async () => {
    mockDeleteProfile.mock.resetCalls();

    const result = await EmailProfileTool.execute(
      "call-1",
      { action: "delete", name: "personal" },
      new AbortController().signal,
    );
    assert.strictEqual(mockDeleteProfile.mock.callCount(), 1);
    assert.strictEqual(mockDeleteProfile.mock.calls[0].arguments[0], "personal");
    assert.strictEqual(result.details.deleted, true);
  });

  it("requires a name for use and delete", () => {
    assert.throws(
      () => EmailProfileTool.execute("call-1", { action: "use" }, new AbortController().signal),
      /requires a profile name/,
    );
    assert.throws(
      () => EmailProfileTool.execute("call-1", { action: "delete" }, new AbortController().signal),
      /requires a profile name/,
    );
  });

  it("rejects unknown actions", () => {
    assert.throws(
      () =>
        EmailProfileTool.execute(
          "call-1",
          { action: "nuke", name: "x" },
          new AbortController().signal,
        ),
      /Unknown action/,
    );
  });
});
