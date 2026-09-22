/**
 * Mail backend dispatch.
 *
 * Tools call these functions; each one forwards to the IMAP client or, for
 * Microsoft Graph profiles, to the Graph client. Signatures match the IMAP
 * client so existing callers and tests keep working.
 *
 * Namespace imports on purpose: tests mock the client modules with only the
 * functions they need, and named imports of missing exports would fail.
 */

import * as imap from "./imap-client.ts";
import * as graph from "./graph-client.ts";
import type { EmailConfig, MessageUid } from "../types.ts";

function useGraph(config: EmailConfig): boolean {
  return config.oauth?.provider === "microsoft" && config.oauth.api === "graph";
}

function imapUid(uid: MessageUid): number {
  const n = typeof uid === "number" ? uid : Number(uid);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid UID "${uid}": this profile uses IMAP, which needs a numeric UID.`);
  }
  return n;
}

export function listMailboxes(config: EmailConfig, signal?: AbortSignal) {
  return useGraph(config) ? graph.listMailboxes(config, signal) : imap.listMailboxes(config, signal);
}

export function fetchHeaders(
  config: EmailConfig,
  mailbox: string,
  limit: number,
  unseen: boolean,
  signal?: AbortSignal,
) {
  return useGraph(config)
    ? graph.fetchHeaders(config, mailbox, limit, unseen, signal)
    : imap.fetchHeaders(config, mailbox, limit, unseen, signal);
}

export function searchEmails(
  config: EmailConfig,
  mailbox: string,
  criteria: any[],
  limit: number,
  signal?: AbortSignal,
) {
  return useGraph(config)
    ? graph.searchEmails(config, mailbox, criteria, limit, signal)
    : imap.searchEmails(config, mailbox, criteria, limit, signal);
}

export function readEmail(
  config: EmailConfig,
  uid: MessageUid,
  mailbox: string,
  downloadDir: string | null,
  signal?: AbortSignal,
) {
  return useGraph(config)
    ? graph.readEmail(config, uid, mailbox, downloadDir, signal)
    : imap.readEmail(config, imapUid(uid), mailbox, downloadDir, signal);
}

export function setFlags(
  config: EmailConfig,
  uid: MessageUid,
  mailbox: string,
  addFlags: ReadonlyArray<string>,
  removeFlags: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<void> {
  return useGraph(config)
    ? graph.setFlags(config, uid, mailbox, addFlags, removeFlags, signal)
    : imap.setFlags(config, imapUid(uid), mailbox, addFlags, removeFlags, signal);
}

export function deleteEmail(
  config: EmailConfig,
  uid: MessageUid,
  mailbox: string,
  signal?: AbortSignal,
): Promise<{ expunged: boolean; movedTo?: string }> {
  return useGraph(config)
    ? graph.deleteEmail(config, uid, mailbox, signal)
    : imap.deleteEmail(config, imapUid(uid), mailbox, signal);
}

export function moveEmail(
  config: EmailConfig,
  uid: MessageUid,
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  return useGraph(config)
    ? graph.moveEmail(config, uid, source, destination, signal)
    : imap.moveEmail(config, imapUid(uid), source, destination, signal);
}

export function appendDraftMessage(
  config: EmailConfig,
  draftMailbox: string,
  raw: Buffer | string,
  signal?: AbortSignal,
): Promise<void> {
  return useGraph(config)
    ? graph.appendDraftMessage(config, draftMailbox, raw, signal)
    : imap.appendDraftMessage(config, draftMailbox, raw, signal);
}
