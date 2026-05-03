/**
 * Namen orientiert an den Listen auf krankenkassen.de (GKV, PKV).
 *
 * Logos in der UI: feste URLs aus `krankenkassenDeLogos.generated.ts` (von dort listenbasiert erzeugt).
 * Zusätzlich optional `logoHost` → Favicon-Fallback (Google / DuckDuckGo), siehe insurerBranding.
 *
 * @see https://www.krankenkassen.de/gesetzliche-krankenkassen/krankenkassen-liste/
 * @see https://www.krankenkassen.de/private-krankenversicherung/pkv-liste/
 */

export type InsurerCatalogEntry = {
  name: string;
  /** Hostname ohne Schema, z. B. barmer.de — für Favicon-URL */
  logoHost?: string;
};

const e = (name: string, logoHost?: string): InsurerCatalogEntry =>
  logoHost ? { name, logoHost } : { name };

/** Ersatzkassen, IKK, AOK, LKK + typische Domains */
const GKV_WITH_HOST: InsurerCatalogEntry[] = [
  e("BARMER", "barmer.de"),
  e("DAK Gesundheit", "dak.de"),
  e("HEK - Hanseatische Krankenkasse", "hek.de"),
  e("hkk Krankenkasse", "hkk.de"),
  e("KKH Kaufmännische Krankenkasse", "kkh.de"),
  e("KNAPPSCHAFT", "knappschaft.de"),
  e("Techniker Krankenkasse (TK)", "tk.de"),
  e("BIG direkt gesund", "big-direkt-gesund.de"),
  e("IKK - Die Innovationskasse", "die-ik.de"),
  e("IKK Brandenburg und Berlin", "ikkb.de"),
  e("IKK classic", "ikklassik.de"),
  e("IKK gesund plus", "ikk-gesundplus.de"),
  e("IKK Südwest", "ikk-suedwest.de"),
  e("AOK Baden-Württemberg", "aok-bw.de"),
  e("AOK Bayern", "aokbayern.de"),
  e("AOK Bremen/Bremerhaven", "aok-bremen.de"),
  e("AOK Hessen", "aok-hessen.de"),
  e("AOK Niedersachsen", "aok-niedersachsen.de"),
  e("AOK Nordost", "aok-nordost.de"),
  e("AOK NordWest", "aok-nordwest.de"),
  e("AOK PLUS", "aokplus.de"),
  e("AOK Rheinland-Pfalz/Saarland", "aok-rps.de"),
  e("AOK Rheinland/Hamburg", "aok-rheinland-hamburg.de"),
  e("AOK Sachsen-Anhalt", "aok-san.de"),
  e("Landwirtschaftliche Krankenkasse - LKK", "lkk.de"),
];

/** Betriebskrankenkassen & weitere GKV-Kassen (Listenstand krankenkassen.de) */
const GKV_BKK_AND_MORE: readonly string[] = [
  "Audi BKK",
  "BAHN-BKK",
  "BERGISCHE KRANKENKASSE",
  "Bertelsmann BKK",
  "BKK Akzo Nobel Bayern",
  "BKK Diakonie",
  "BKK DürkoppAdler",
  "BKK EUREGIO",
  "BKK exklusiv",
  "BKK Faber-Castell & Partner",
  "BKK firmus",
  "BKK Freudenberg",
  "BKK GILDEMEISTER SEIDENSTICKER",
  "BKK HERKULES",
  "BKK Linde",
  "bkk melitta hmr",
  "BKK PFAFF",
  "BKK Pfalz",
  "BKK ProVita",
  "BKK Public",
  "BKK SBH",
  "BKK Scheufelen",
  "BKK Technoform",
  "BKK VDN",
  "BKK VerbundPlus",
  "BKK Werra-Meissner",
  "BKK WIRTSCHAFT & FINANZEN",
  "BKK24",
  "Bosch BKK",
  "Continentale BKK",
  "Debeka BKK",
  "energie-BKK",
  "Heimat Krankenkasse",
  "mhplus Krankenkasse",
  "mkk - meine krankenkasse",
  "Mobil Krankenkasse",
  "novitas bkk",
  "Pronova BKK",
  "R+V Betriebskrankenkasse",
  "Salus BKK",
  "SBK",
  "SECURVITA Krankenkasse",
  "SKD BKK",
  "TUI BKK",
  "VIACTIV Krankenkasse",
  "vivida bkk",
  "WMF BKK",
  "ZF BKK",
  "BKK B. Braun Aesculap",
  "BKK Deutsche Bank AG",
  "BKK evm",
  "BKK EWE",
  "BKK Groz-Beckert",
  "BKK KARL MAYER",
  "BKK MAHLE",
  "BKK Merck",
  "BKK Miele",
  "BKK MTU",
  "BKK PwC",
  "BKK Rieker.Ricosta.Weisser",
  "BKK Salzgitter",
  "BKK Würth",
  "BMW BKK",
  "Ernst & Young BKK",
  "Koenig & Bauer BKK",
  "Krones BKK",
  "Mercedes-Benz BKK",
  "Südzucker-BKK",
] as const;

/** Bekannte BKK-Domains (optional, Rest ohne Logo) */
const BKK_EXTRA_HOSTS: Record<string, string> = {
  "Audi BKK": "audi-bkk.de",
  SBK: "sbk.de",
  "mhplus Krankenkasse": "mhplus.de",
  "Continentale BKK": "continentale.de",
  "Debeka BKK": "debeka.de",
  "Bosch BKK": "bosch.com",
  "VIACTIV Krankenkasse": "viactiv.de",
  "SECURVITA Krankenkasse": "securvita.de",
  BKK24: "bkk24.de",
  "novitas bkk": "novitas-bkk.de",
  "Heimat Krankenkasse": "heimat-krankenkasse.de",
  "Mobil Krankenkasse": "mobil-krankenkasse.de",
  "BAHN-BKK": "bahn-bkk.de",
  "energie-BKK": "energie-bkk.de",
  "Pronova BKK": "pronova.de",
  "Salus BKK": "salus-bkk.de",
  "SKD BKK": "skd-bkk.de",
  "TUI BKK": "tui-bkk.de",
  "vivida bkk": "vividabkk.de",
  "mkk - meine krankenkasse": "meine-krankenkasse.de",
};

function bkkEntry(name: string): InsurerCatalogEntry {
  const host = BKK_EXTRA_HOSTS[name];
  return host ? e(name, host) : e(name);
}

export const GKV_INSURERS: readonly InsurerCatalogEntry[] = [
  ...GKV_WITH_HOST,
  ...GKV_BKK_AND_MORE.map((name) => bkkEntry(name)),
];

export const PKV_INSURERS: readonly InsurerCatalogEntry[] = [
  e("Allianz Private Krankenversicherung", "allianz.de"),
  e("Alte Oldenburger Krankenversicherung", "alte-oldenburger.de"),
  e("ARAG Krankenversicherung", "arag.de"),
  e("AXA Krankenversicherung", "axa.de"),
  e("Barmenia Krankenversicherung", "barmenia.de"),
  e("Concordia Krankenversicherung", "concordia.de"),
  e("Continentale Krankenversicherung", "continentale.de"),
  e("Debeka Krankenversicherung", "debeka.de"),
  e("DEVK Krankenversicherung", "devk.de"),
  e("DFV Deutsche Familienversicherung", "dfv.de"),
  e("Die Bayerische - BBL", "diebayerische.de"),
  e("DKV Deutsche Krankenversicherung", "dkv.de"),
  e("ENVIVAS Krankenversicherung", "envivas.de"),
  e("ERGO Direkt Krankenversicherung", "ergo.de"),
  e("Generali Krankenversicherung", "generali.de"),
  e("Gothaer Krankenversicherung", "gothaer.de"),
  e("Hallesche Krankenversicherung", "hallesche.de"),
  e("HanseMerkur Krankenversicherung", "hansemerkur.de"),
  e("HUK-Coburg-Krankenversicherung", "huk.de"),
  e("Inter Krankenversicherung", "inter.de"),
  e("LKH Landeskrankenhilfe", "lkh.de"),
  e("LVM Krankenversicherung", "lvm.de"),
  e("Mecklenburgische Krankenversicherung", "mecklenburgische.de"),
  e("Münchener Verein Krankenversicherung", "muenchener-verein.de"),
  e("Nürnberger Krankenversicherung", "nuernberger.de"),
  e("ottonova Krankenversicherung", "ottonova.de"),
  e("R+V Krankenversicherung", "ruv.de"),
  e("Signal Krankenversicherung", "signal-iduna.de"),
  e("Süddeutsche Krankenversicherung", "sdk.de"),
  e("UKV - Union Krankenversicherung", "ukv.de"),
  e("Universa Krankenversicherung", "universa.de"),
  e("Versicherungskammer Bayern", "vkb.de"),
  e("vigo Krankenversicherung", "vigo.de"),
  e("Württembergische Krankenversicherung", "wuerttembergische.de"),
];

export const GKV_NAMES: readonly string[] = GKV_INSURERS.map((x) => x.name);
export const PKV_NAMES: readonly string[] = PKV_INSURERS.map((x) => x.name);
