/**
 * Configuration persistence and state.
 *
 * Holds the current EmailConfig in module-level state.
 * Reads/writes from ~/.pi/email-config.json.
 */

import type { EmailConfig } from "./types";
import { EmailNotConfiguredError } from "./types";

// ── Mutable state ───────────────────────────────────────────────────────────

let currentConfig: EmailConfig | null = null;

// ── Path resolution ─────────────────────────────────────────────────────────

function configPath(): string {
  const path = require("node:path");
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return path.join(home, ".pi", "email-config.json");
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function loadConfig(): void {
  try {
    const fs = require("node:fs");
    const filePath = configPath();
    if (fs.existsSync(filePath)) {
      currentConfig = JSON.parse(fs.readFileSync(filePath, "utf-8")) as EmailConfig;
    }
  } catch {
    currentConfig = null;
  }
}

export function saveConfig(config: EmailConfig): void {
  const fs = require("node:fs");
  const path = require("node:path");
  const filePath = configPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  currentConfig = config;
}

// ── Access ──────────────────────────────────────────────────────────────────

export function getConfig(): EmailConfig | null {
  return currentConfig;
}

export function getConfigOrThrow(): EmailConfig {
  if (!currentConfig) {
    throw new EmailNotConfiguredError();
  }
  return currentConfig;
}

/** @internal Reset state — for testing only */
export function _resetForTesting(): void {
  currentConfig = null;
}
