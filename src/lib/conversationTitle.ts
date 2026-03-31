/** Visible title in lists; legacy DB default treated as empty. */
export function conversationListTitleDisplay(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t || t === "Neues Gespräch") return null;
  return t;
}

export type ConversationTitleStatus = "queued" | "invoice" | "service" | "engine3" | "direct" | "generic";

const MAX_TEXT_WITH_FILES = 48;
const MAX_TEXT_ONLY = 72;
const MAX_TOTAL = 118;

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function filePart(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return "";
  const first = clean[0]!;
  if (clean.length === 1) return first;
  return `${first} (+${clean.length - 1})`;
}

function resultSuffix(status: ConversationTitleStatus, hasFiles: boolean): string {
  switch (status) {
    case "queued":
      return hasFiles ? " · Abrechnung prüfen" : "";
    case "invoice":
      return " · Rechnungsprüfung";
    case "service":
      return " · Vorschläge";
    case "engine3":
      return " · Engine 3";
    case "direct":
      return " · Direktmodell";
    case "generic":
      return hasFiles ? " · Auswertung" : "";
  }
}

/**
 * Sidebar / list title for a conversation from first user turn + optional file names
 * and pipeline status (queued vs. result kind).
 */
export function buildConversationTitle(args: {
  userText: string;
  fileNames: string[];
  status: ConversationTitleStatus;
}): string {
  const text = args.userText.trim();
  const names = args.fileNames.map((n) => n.trim()).filter(Boolean);
  const hasFiles = names.length > 0;
  const fp = filePart(names);

  let base: string;
  if (text && hasFiles) {
    base = `${truncate(text, MAX_TEXT_WITH_FILES)} · ${fp}`;
  } else if (text) {
    base = truncate(text, MAX_TEXT_ONLY);
  } else if (hasFiles) {
    base = fp;
  } else {
    base = "";
  }

  const suffix = resultSuffix(args.status, hasFiles);
  let combined = `${base}${suffix}`.trim();

  if (combined.length > MAX_TOTAL) {
    const room = MAX_TOTAL - suffix.length;
    if (text && hasFiles) {
      const sep = " · ";
      const textBudget = Math.max(12, room - fp.length - sep.length);
      base = `${truncate(text, Math.min(MAX_TEXT_WITH_FILES, textBudget))}${sep}${fp}`;
    } else if (text) {
      base = truncate(text, Math.max(8, room));
    } else if (hasFiles) {
      base = truncate(fp, Math.max(8, room));
    }
    combined = `${base}${suffix}`.trim();
  }

  return combined || "Chat";
}
