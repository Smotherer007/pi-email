/**
 * Pure helpers shared by email_reply and email_draft_reply.
 *
 * Both tools derive the same recipient set and References chain from the
 * original message; keeping that logic here avoids the two implementations
 * drifting apart.
 */

/** Recipients of a reply, derived from the original message's headers. */
export function buildReplyRecipients(
  parsed: any,
  ownAddress: string,
  replyAll: boolean,
): { to: string; cc: string } {
  // Reply-To wins over From when present -- that is the whole point of the
  // header, and mailing lists and no-reply senders rely on it.
  const replyTo = parsed.replyTo?.value?.map((a: any) => a.address).filter(Boolean) || [];
  const fromAddress = parsed.from?.value?.[0]?.address || "";
  const to =
    replyTo.length > 0
      ? replyTo.join(", ")
      : fromAddress || parsed.from?.text || "";

  if (!replyAll) return { to, cc: "" };

  const normalized = (value: string) => value.trim().toLowerCase();
  const alreadyAddressed = new Set(
    [...replyTo, fromAddress, ownAddress].filter(Boolean).map(normalized),
  );

  const toAddresses = parsed.to?.value?.map((a: any) => a.address).filter(Boolean) || [];
  const ccAddresses = parsed.cc?.value?.map((a: any) => a.address).filter(Boolean) || [];

  const cc: string[] = [];
  for (const address of [...toAddresses, ...ccAddresses]) {
    const key = normalized(address);
    // Skips the sender, the Reply-To target, our own address (replying to all
    // used to CC the sender back to themselves) and duplicates.
    if (alreadyAddressed.has(key)) continue;
    alreadyAddressed.add(key);
    cc.push(address);
  }

  return { to, cc: cc.join(", ") };
}

/** Build the References chain for the reply. */
export function buildReferences(
  existing: string | ReadonlyArray<string> | undefined,
  messageId: string,
): string[] {
  const chain = Array.isArray(existing)
    ? [...existing]
    : existing
      ? [existing]
      : [];
  if (messageId && !chain.includes(messageId)) chain.push(messageId);
  return chain;
}
