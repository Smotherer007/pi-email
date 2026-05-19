import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { EmailConfig } from "../src/types";

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

import * as configMod from "../src/config";

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
    expect(configMod.getConfig()).toBeNull();
  });

  it("getConfigOrThrow throws when no profiles", () => {
    expect(() => configMod.getConfigOrThrow()).toThrow("Email not configured");
  });

  it("loadConfig sets empty state when no file exists", () => {
    configMod.loadConfig();
    expect(configMod.getConfig()).toBeNull();
    expect(configMod.getProfiles()).toEqual({});
    expect(configMod.getActiveProfile()).toBeNull();
  });

  it("saveProfile creates a named profile and sets it active", () => {
    configMod.saveProfile("work", sampleConfig);

    expect(configMod.getActiveProfile()).toBe("work");
    expect(configMod.getConfig()).toEqual(sampleConfig);
    expect(configMod.getProfiles()).toHaveProperty("work");
  });

  it("saveProfile auto-sets first profile as active", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    // active should remain "work" since it was the first
    expect(configMod.getActiveProfile()).toBe("work");
    expect(Object.keys(configMod.getProfiles())).toHaveLength(2);
  });

  it("setActiveProfile switches active profile", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    configMod.setActiveProfile("personal");
    expect(configMod.getActiveProfile()).toBe("personal");
    expect(configMod.getConfig()).toEqual(sampleConfig2);
  });

  it("setActiveProfile throws for unknown profile", () => {
    configMod.saveProfile("work", sampleConfig);
    expect(() => configMod.setActiveProfile("nonexistent")).toThrow(
      'Profile "nonexistent" does not exist',
    );
  });

  it("deleteProfile removes profile and falls back to next", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    expect(configMod.deleteProfile("work")).toBe(true);
    expect(configMod.getActiveProfile()).toBe("personal");
    expect(configMod.getProfile("work")).toBeNull();
  });

  it("deleteProfile returns false for unknown profile", () => {
    expect(configMod.deleteProfile("ghost")).toBe(false);
  });

  it("resolveConfig returns specific profile by name", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);
    configMod.setActiveProfile("work");

    const cfg = configMod.resolveConfig("personal");
    expect(cfg).toEqual(sampleConfig2);
  });

  it("resolveConfig falls back to active profile", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.setActiveProfile("work");

    const cfg = configMod.resolveConfig();
    expect(cfg).toEqual(sampleConfig);
  });

  it("resolveConfig throws for unknown profile", () => {
    configMod.saveProfile("work", sampleConfig);
    expect(() => configMod.resolveConfig("ghost")).toThrow(
      'Profile "ghost" not found',
    );
  });

  it("persists and loads multiple profiles", () => {
    configMod.saveProfile("work", sampleConfig);
    configMod.saveProfile("personal", sampleConfig2);

    // Simulate fresh load
    configMod._resetForTesting();
    configMod.loadConfig();

    expect(Object.keys(configMod.getProfiles())).toHaveLength(2);
    expect(configMod.getActiveProfile()).toBe("work");
    expect(configMod.getProfile("work")).toEqual(sampleConfig);
    expect(configMod.getProfile("personal")).toEqual(sampleConfig2);
  });

  it("backward-compat: migrates old flat config format", () => {
    // Write old flat format
    fs.writeFileSync(testConfigFile, JSON.stringify(sampleConfig, null, 2));

    configMod.loadConfig();

    expect(Object.keys(configMod.getProfiles())).toHaveLength(1);
    expect(configMod.getActiveProfile()).toBe("default");
    expect(configMod.getProfile("default")).toEqual(sampleConfig);

    // Verify it persists in new format
    const raw = fs.readFileSync(testConfigFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.profiles.default).toEqual(sampleConfig);
    expect(parsed.activeProfile).toBe("default");
  });

  it("loadConfig handles invalid JSON gracefully", () => {
    fs.writeFileSync(testConfigFile, "not valid json");
    configMod.loadConfig();
    expect(configMod.getConfig()).toBeNull();
  });

  it("loadConfig falls back to first profile if activeProfile is stale", () => {
    // Write a profiles file with a stale activeProfile
    const staleData = {
      profiles: { work: sampleConfig, personal: sampleConfig2 },
      activeProfile: "deleted",
    };
    fs.writeFileSync(testConfigFile, JSON.stringify(staleData, null, 2));

    configMod.loadConfig();
    expect(configMod.getActiveProfile()).toBe("work");
  });
});
