import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { EmailConfig } from "../src/types.ts";

const testHome = path.join(os.tmpdir(), "pi-email-test-" + Date.now());
const testConfigDir = path.join(testHome, ".pi");
const testConfigFile = path.join(testConfigDir, "email-config.json");

function setEnv(key: string, value: string) {
  process.env[key] = value;
}

const sampleConfig: EmailConfig = {
  imap: {
    host: "imap.example.com",
    port: 993,
    tls: true,
    user: "test@example.com",
    password: "secret123",
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "test@example.com",
    password: "secret456",
  },
  fromName: "Test User",
};

const sampleConfig2: EmailConfig = {
  imap: {
    host: "imap.other.com",
    port: 993,
    tls: true,
    user: "other@example.com",
    password: "password456",
  },
  smtp: {
    host: "smtp.other.com",
    port: 465,
    secure: true,
    user: "other@example.com",
    password: "password456",
  },
};

import * as configMod from "../src/config.ts";

describe("Config persistence — multi-profile", () => {
  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true });
    }
    fs.mkdirSync(testConfigDir, { recursive: true });
    setEnv("HOME", testHome);
    setEnv("USERPROFILE", testHome);
    configMod._resetForTesting();
  });

  afterEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true });
    }
  });

  it("getConfig returns null before any profile is saved", () => {
    assert.strictEqual(configMod.getConfig(), null);
  });

  it("getConfigOrThrow throws when no profiles", () => {
    assert.throws(() => configMod.getConfigOrThrow(), /Email not configured/);
  });

  it("loadConfig sets empty state when no file exists", () => {
    configMod.loadConfig();
    assert.strictEqual(configMod.getConfig(), null);
    assert.deepStrictEqual(configMod.getProfiles(), {});
    assert.strictEqual(configMod.getActiveProfile(), null);
  });

  it("saveProfile creates a named profile and sets it active", () => {
    configMod.saveProfile("work", sampleConfig);

    assert.strictEqual(configMod.getActiveProfile(), "work");
    assert.deepStrictEqual(configMod.getConfig(), sampleConfig);
    assert.ok(configMod.getProfiles().work !== undefined);
  });

  it("saveProfile auto-sets first profile as active", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    assert.strictEqual(configMod.getActiveProfile(), "work");
    assert.strictEqual(Object.keys(configMod.getProfiles()).length, 2);
  });

  it("setActiveProfile switches active profile", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    configMod.setActiveProfile("personal");
    assert.strictEqual(configMod.getActiveProfile(), "personal");
    assert.deepStrictEqual(configMod.getConfig(), sampleConfig2);
  });

  it("setActiveProfile throws for unknown profile", () => {
    configMod.saveProfile("work", sampleConfig);
    assert.throws(
      () => configMod.setActiveProfile("nonexistent"),
      /"nonexistent" does not exist/,
    );
  });

  it("deleteProfile removes profile and falls back to next", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    assert.strictEqual(configMod.deleteProfile("work"), true);
    assert.strictEqual(configMod.getActiveProfile(), "personal");
    assert.strictEqual(configMod.getProfile("work"), null);
  });

  it("deleteProfile returns false for unknown profile", () => {
    assert.strictEqual(configMod.deleteProfile("ghost"), false);
  });

  it("resolveConfig returns specific profile by name", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);
    configMod.setActiveProfile("work");

    const cfg = configMod.resolveConfig("personal");
    assert.deepStrictEqual(cfg, sampleConfig2);
  });

  it("resolveConfig falls back to active profile", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.setActiveProfile("work");

    const cfg = configMod.resolveConfig();
    assert.deepStrictEqual(cfg, sampleConfig);
  });

  it("resolveConfig throws for unknown profile", () => {
    configMod.saveProfile("work", sampleConfig);
    assert.throws(
      () => configMod.resolveConfig("ghost"),
      /"ghost" not found/,
    );
  });

  it("persists and loads multiple profiles", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    configMod._resetForTesting();
    configMod.loadConfig();

    assert.strictEqual(Object.keys(configMod.getProfiles()).length, 2);
    assert.strictEqual(configMod.getActiveProfile(), "work");
    assert.deepStrictEqual(configMod.getProfile("work"), sampleConfig);
    assert.deepStrictEqual(configMod.getProfile("personal"), sampleConfig2);
  });

  it("backward-compat: migrates old flat config format", () => {
    fs.writeFileSync(testConfigFile, JSON.stringify(sampleConfig, null, 2));

    configMod.loadConfig();

    assert.strictEqual(Object.keys(configMod.getProfiles()).length, 1);
    assert.strictEqual(configMod.getActiveProfile(), "default");
    assert.deepStrictEqual(configMod.getProfile("default"), sampleConfig);

    const raw = fs.readFileSync(testConfigFile, "utf-8");
    const parsed = JSON.parse(raw);
    assert.deepStrictEqual(parsed.profiles.default, sampleConfig);
    assert.strictEqual(parsed.activeProfile, "default");
  });

  it("loadConfig handles invalid JSON gracefully", () => {
    fs.writeFileSync(testConfigFile, "not valid json");
    configMod.loadConfig();
    assert.strictEqual(configMod.getConfig(), null);
  });

  it("loadConfig falls back to first profile if activeProfile is stale", () => {
    const staleData = {
      profiles: { work: sampleConfig, personal: sampleConfig2 },
      activeProfile: "deleted",
    };
    fs.writeFileSync(testConfigFile, JSON.stringify(staleData, null, 2));

    configMod.loadConfig();
    assert.strictEqual(configMod.getActiveProfile(), "work");
  });
});
