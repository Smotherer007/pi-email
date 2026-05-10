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

// The config module has module-level mutable state.
// We import once and reset state manually via _resetForTesting().

import * as configMod from "../src/config";

describe("Config persistence", () => {
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

  it("getConfig returns null before load or save", () => {
    expect(configMod.getConfig()).toBeNull();
  });

  it("getConfigOrThrow throws EmailNotConfiguredError when no config", () => {
    expect(() => configMod.getConfigOrThrow()).toThrow("Email not configured");
  });

  it("loadConfig sets null when no file exists", () => {
    configMod.loadConfig();
    expect(configMod.getConfig()).toBeNull();
  });

  it("loadConfig sets null when file is invalid JSON", () => {
    fs.writeFileSync(testConfigFile, "not valid json");
    configMod.loadConfig();
    expect(configMod.getConfig()).toBeNull();
  });

  it("loadConfig loads from file when exists", () => {
    fs.writeFileSync(testConfigFile, JSON.stringify(sampleConfig, null, 2));
    configMod.loadConfig();
    const config = configMod.getConfig();
    expect(config).not.toBeNull();
    expect(config!.imap.host).toBe("imap.example.com");
    expect(config!.smtp.host).toBe("smtp.example.com");
    expect(config!.fromName).toBe("Test User");
  });

  it("saveConfig writes file and updates state", () => {
    configMod.saveConfig(sampleConfig);

    const config = configMod.getConfig();
    expect(config).not.toBeNull();
    expect(config!.imap.user).toBe("test@example.com");

    const raw = fs.readFileSync(testConfigFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.imap.host).toBe("imap.example.com");
    expect(parsed.fromName).toBe("Test User");
  });

  it("saveConfig creates directory if missing", () => {
    fs.rmSync(testConfigDir, { recursive: true });
    expect(fs.existsSync(testConfigDir)).toBe(false);

    configMod.saveConfig(sampleConfig);

    expect(fs.existsSync(testConfigDir)).toBe(true);
    expect(fs.existsSync(testConfigFile)).toBe(true);
    expect(configMod.getConfig()).not.toBeNull();
  });

  it("getConfigOrThrow returns config when loaded", () => {
    fs.writeFileSync(testConfigFile, JSON.stringify(sampleConfig, null, 2));
    configMod.loadConfig();
    const config = configMod.getConfigOrThrow();
    expect(config.imap.host).toBe("imap.example.com");
  });
});
