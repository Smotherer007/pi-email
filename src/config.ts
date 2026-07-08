/**
 * Configuration persistence and state.
 *
 * Stores named email profiles in ~/.pi/email-config.json.
 * Supports multiple profiles with an active profile selector.
 *
 * File format:
 *   { "profiles": { "name": EmailConfig, ... }, "activeProfile": "name" }
 *
 * Backward-compatible: if the old flat EmailConfig format is found,
 * it is auto-migrated to { profiles: { "default": ... }, activeProfile: "default" }.
 */

import type { EmailConfig, EmailProfiles } from "./types";
import { EmailNotConfiguredError } from "./types";

// Mutable state

let profiles: Record<string, EmailConfig> = {};
let activeProfile: string | null = null;

// Path resolution

function configPath(): string {
  const path = require("node:path");
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return path.join(home, ".pi", "email-config.json");
}

// Persistence

function persistProfiles(): void {
  const fs = require("node:fs");
  const path = require("node:path");
  const filePath = configPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data: EmailProfiles = { profiles, activeProfile };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function loadConfig(): void {
  try {
    const fs = require("node:fs");
    const filePath = configPath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      // Backward compatibility: if old flat format, migrate
      if (raw && typeof raw === "object" && raw.imap && !("profiles" in raw)) {
        const migrated: EmailProfiles = {
          profiles: { default: raw as EmailConfig },
          activeProfile: "default",
        };
        profiles = migrated.profiles;
        activeProfile = migrated.activeProfile;
        persistProfiles();
        return;
      }

      if (raw && typeof raw === "object" && raw.profiles) {
        profiles = raw.profiles;
        // Validate activeProfile: if the stored name no longer exists, pick first
        if (raw.activeProfile && profiles[raw.activeProfile]) {
          activeProfile = raw.activeProfile;
        } else if (Object.keys(profiles).length > 0) {
          activeProfile = Object.keys(profiles)[0];
        } else {
          activeProfile = null;
        }
      }
    }
  } catch {
    profiles = {};
    activeProfile = null;
  }
}

// Access

export function getConfig(): EmailConfig | null {
  if (!activeProfile) return null;
  return profiles[activeProfile] ?? null;
}

export function getConfigOrThrow(): EmailConfig {
  const config = getConfig();
  if (!config) {
    throw new EmailNotConfiguredError();
  }
  return config;
}

/** Get a specific profile by name, or null if not found. */
export function getProfile(name: string): EmailConfig | null {
  return profiles[name] ?? null;
}

/**
 * Resolve a profile parameter: if a name is given, return that profile
 * (or throw if not found). Otherwise, return the active profile or throw.
 */
export function resolveConfig(profileName?: string): EmailConfig {
  if (profileName) {
    const config = getProfile(profileName);
    if (!config) {
      throw new Error(
        `Profile "${profileName}" not found. Available: ${Object.keys(profiles).join(", ") || "none"}`,
      );
    }
    return config;
  }
  return getConfigOrThrow();
}

export function getProfiles(): Record<string, EmailConfig> {
  return { ...profiles };
}

export function getActiveProfile(): string | null {
  return activeProfile;
}

// Mutations

export function saveProfile(name: string, config: EmailConfig): void {
  profiles[name] = config;
  // Auto-set as active if it's the first profile or no active profile
  if (!activeProfile || Object.keys(profiles).length === 1) {
    activeProfile = name;
  }
  persistProfiles();
}

export function setActiveProfile(name: string): void {
  if (!profiles[name]) {
    throw new Error(
      `Profile "${name}" does not exist. Available: ${Object.keys(profiles).join(", ") || "none"}`,
    );
  }
  activeProfile = name;
  persistProfiles();
}

export function deleteProfile(name: string): boolean {
  if (!profiles[name]) return false;
  delete profiles[name];
  if (activeProfile === name) {
    const keys = Object.keys(profiles);
    activeProfile = keys.length > 0 ? keys[0] : null;
  }
  persistProfiles();
  return true;
}

/** @internal Reset state — for testing only */
export function _resetForTesting(): void {
  profiles = {};
  activeProfile = null;
}
