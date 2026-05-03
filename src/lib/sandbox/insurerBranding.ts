import { GKV_INSURERS, PKV_INSURERS, type InsurerCatalogEntry } from "@/data/sandbox/krankenkassenCatalog";
import { KRANKENKASSEN_DE_LOGO_URL as KK_GENERATED } from "@/data/sandbox/krankenkassenDeLogos.generated";
import { KRANKENKASSEN_DE_LOGO_EXTRA } from "@/data/sandbox/krankenkassenDeLogos.manual";

/** Kombinierte Logo-Tabelle: Scraped von krankenkassen.de + manuelle Ergänzungen. */
const KK_ALL: Record<string, string> = { ...KK_GENERATED, ...KRANKENKASSEN_DE_LOGO_EXTRA };

const byName = new Map<string, InsurerCatalogEntry>();
const byNormalizedName = new Map<string, InsurerCatalogEntry>();

function normalizeInsurerLabel(label: string): string {
  return label
    .trim()
    .replace(/\u2013/g, "-")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Signifikante Wörter für Matching (z. B. „dak“, „gesundheit“, „techniker“). */
function tokenizeInsurerWords(normalizedLabel: string): string[] {
  const cleaned = normalizedLabel.replace(/[()[\].,]/g, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const w = raw.replace(/^[^a-z0-9äöüß]+|[^a-z0-9äöüß]+$/gi, "");
    if (w.length < 3) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

for (const row of [...GKV_INSURERS, ...PKV_INSURERS]) {
  byName.set(row.name, row);
  const key = normalizeInsurerLabel(row.name);
  const prev = byNormalizedName.get(key);
  if (!prev || (!prev.logoHost && row.logoHost)) byNormalizedName.set(key, row);
}

const kkLogoByNormalized = new Map<string, string>();
for (const [label, url] of Object.entries(KK_ALL)) {
  kkLogoByNormalized.set(normalizeInsurerLabel(label), url);
}

/** Abweichungen vom Listenwortlaut → exakter Schlüssel in KK_ALL */
const KK_LOGO_LABEL_ALIASES: Record<string, string> = {
  [normalizeInsurerLabel("mhplus Betriebskrankenkasse")]: "mhplus Krankenkasse",
  [normalizeInsurerLabel("TK")]: "Techniker Krankenkasse (TK)",
};

/**
 * Jedes Wort (Länge ≥ 3) eines Listen-Labels — nur Zuordnungen, die zu genau einem Logo gehören
 * (z. B. „dak“ → DAK Gesundheit; „bkk“ wäre mehrdeutig und fehlt).
 */
function buildKkUniqueTokenToLabel(): Map<string, string> {
  const tokToLabels = new Map<string, string[]>();
  for (const label of Object.keys(KK_ALL)) {
    const seenTok = new Set<string>();
    for (const tok of tokenizeInsurerWords(normalizeInsurerLabel(label))) {
      if (seenTok.has(tok)) continue;
      seenTok.add(tok);
      const arr = tokToLabels.get(tok) ?? [];
      arr.push(label);
      tokToLabels.set(tok, arr);
    }
  }
  const out = new Map<string, string>();
  for (const [tok, labels] of tokToLabels) {
    if (labels.length === 1) out.set(tok, labels[0]!);
  }
  return out;
}

const kkUniqueTokenToLabel = buildKkUniqueTokenToLabel();

function catalogRowForLabel(trimmed: string): InsurerCatalogEntry | undefined {
  const norm = normalizeInsurerLabel(trimmed);
  const direct = byName.get(trimmed) ?? byNormalizedName.get(norm);
  if (direct) return direct;
  for (const tok of tokenizeInsurerWords(norm)) {
    const kkLab = kkUniqueTokenToLabel.get(tok);
    if (!kkLab) continue;
    const hit = byName.get(kkLab) ?? byNormalizedName.get(normalizeInsurerLabel(kkLab));
    if (hit) return hit;
  }
  return undefined;
}

/** Logo-URL wie auf krankenkassen.de (Listen / Overrides). */
function krankenkassenDeLogoUrl(trimmed: string): string | undefined {
  const n = normalizeInsurerLabel(trimmed);
  const aliasTarget = KK_LOGO_LABEL_ALIASES[n];
  if (aliasTarget) {
    const u = KK_ALL[aliasTarget];
    if (u) return u;
  }
  const direct = KK_ALL[trimmed];
  if (direct) return direct;
  const normHit = kkLogoByNormalized.get(n);
  if (normHit) return normHit;
  for (const tok of tokenizeInsurerWords(n)) {
    const lab = kkUniqueTokenToLabel.get(tok);
    if (lab) return KK_ALL[lab];
  }
  return undefined;
}

function domainFromLogoHost(logoHost: string): string {
  return logoHost.replace(/^https?:\/\//, "").split("/")[0]!;
}

/** Google Hosted Favicons — für Sandbox-Prototyp ohne eigene Asset-Pipeline */
export function insurerFaviconUrl(logoHost: string, sizePx = 32): string {
  const domain = domainFromLogoHost(logoHost);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${sizePx}`;
}

function duckduckgoFaviconUrl(logoHost: string): string {
  const domain = domainFromLogoHost(logoHost);
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

/** Reihenfolge: zuerst Google, dann DDG — erhöht Trefferquote wenn eine Quelle blockiert/leer liefert */
export function insurerLogoUrls(logoHost: string, sizePx = 32): string[] {
  return [insurerFaviconUrl(logoHost, sizePx), duckduckgoFaviconUrl(logoHost)];
}

export type InsurerBranding = {
  /** Leer → nur Fallback-Badge */
  logoUrls: string[];
  /** Ein Buchstabe / Kurzzeichen als Fallback */
  mark: string;
};

export function getInsurerBranding(insurerLabel: string | undefined | null): InsurerBranding {
  const trimmed = (insurerLabel ?? "").trim();
  if (!trimmed) return { logoUrls: [], mark: "?" };

  const lower = trimmed.toLowerCase();
  if (lower === "selbstzahler" || lower === "—" || lower === "-")
    return { logoUrls: [], mark: trimmed.slice(0, 2).toUpperCase() };

  const kk = krankenkassenDeLogoUrl(trimmed);
  const row = catalogRowForLabel(trimmed);
  const favs = row?.logoHost ? insurerLogoUrls(row.logoHost) : [];
  const logoUrls = kk ? [kk, ...favs] : favs;

  if (logoUrls.length > 0)
    return {
      logoUrls,
      mark: trimmed.charAt(0).toUpperCase(),
    };

  return { logoUrls: [], mark: trimmed.charAt(0).toUpperCase() };
}
