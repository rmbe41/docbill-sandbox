/**
 * Kanonische, vollständig ausformulierte Begründungs-Beispiele für die GOÄ-Abrechnung.
 * Erweiterbar pro Ziffer; Rückgabe leer, wenn keine Vorlagen hinterlegt sind.
 */

const B1207_GLEITSICHT =
  "Subjektive Brillenunverträglichkeit unter der verordneten Mehrstärkenkorrektur. Es wurde die Brille geprüft und dabei die Fern- sowie Nahpunktbestimmung durchgeführt. Im Verlauf wurden Zentrierung und Höhenanlage der Gläser, der Lesebereich und die Progression mit den geschilderten Beschwerden abgeglichen; es erfolgten mehrere subjektive Mess- und Vergleichsschritte, bis sich eine stabile Fern- und Nahsehschärfe bzw. eine deutliche Beschwerdereduktion einstellte. Die Einzelergebnisse und die vorgenommenen Anpassungsempfehlungen sind im Untersuchungsprotokoll festgehalten.";

const B1207_PRISMEN =
  "Subjektive Unverträglichkeit der Prismenkorrektur. Die Prismenbrille wurde unter Berücksichtigung der angeführten Doppelbilder bzw. Seitenbildverlagerung geprüft; es wurden Fern- und Nahpunkt bestimmt und Prismengrundlage sowie -richtung im Verhältnis zu den Beschwerden beurteilt. Zur Abstimmung der Korrektur wurden wiederholte subjektive Messungen und Vergleiche durchgeführt, bis sich eine nachvollziehbare Besserung der Symptome oder eine belastbare Einstellung ergab. Befund und Messwerte sind dokumentiert.";

const B1207_NAHSCHMERZ =
  "Der Patient gibt Kopfschmerzen und Ermüdung beim Lesen unter der aktuellen Brille an. Zur Abklärung wurde die Mehrstärkenbrille geprüft und die Fern- sowie Nahpunktbestimmung vorgenommen. Es erfolgte ein Abgleich der Nahsehschärfe und des Lesebereichs mit den Beschwerden sowie mehrfache Feineinstellungen, bis die Nahfunktion und die subjektive Toleranz hinreichend beurteilt werden konnten. Anamnese, Messreihen und Ergebnis sind in der Akte vermerkt.";

const B1207_REGELHOECHST =
  "Prüfung der Mehrstärken- bzw. Prismenbrille mit Bestimmung der Fern- und Nahpunkte bei subjektiver Brillenunverträglichkeit. Leistung entsprechend GOÄ 1207 erbracht; Abrechnung zum Regelhöchstsatz (Faktor 2,3). Eine gesonderte Begründung für den Steigerungsfaktor ist bei Abrechnung bis zum Schwellenwert nicht erforderlich; der medizinische Anlass und der Untersuchungsablauf ergeben sich aus der vorliegenden Dokumentation.";

const B1207_STEIGERUNG =
  "Prüfung der Mehrstärkenbrille mit Fern- und Nahpunktbestimmung bei subjektiver Brillenunverträglichkeit. Der Untersuchungsablauf gestaltete sich zeit- und messaufwändig, da mehrere unterbrochene Messreihen und wiederholte Vergleichssitzungen notwendig waren, bis eine belastbare Fern- und Nahkorrektur beurteilt werden konnte. Aus diesem Grund wird der erhöhte Steigerungsfaktor gegenüber dem Regelhöchstsatz als nachvollziehbar und im Einzelfall angemessen erachtet.";

const B1225_GLUKOM =
  "Zur Verlaufsbeurteilung bei Verdacht bzw. bekannter Augeninnendruckerhöhung wurde eine Kampimetrie (Bjerrum-Feld) bzw. perimetrische Gesichtsfeldmessung durchgeführt. Es erfolgte die Einweisung des Patienten, mehrfache Antwortkontrollen bei Grenzbefunden sowie die Abgrenzung artefizieller Ausfälle gegenüber relevanten Gesichtsfelddefekten. Befund und Messprotokoll sind dokumentiert; die Ergebnisse fließen in die weiterführende Therapieplanung ein.";

const B1225_NEURO =
  "Klinisch bestand der Verdacht auf einen homonymen oder inhomogenen Gesichtsfeldausfall bzw. auf eine Störung der zentralen Sehfunktion; zur Objektivierung wurde eine Kampimetrie (Bjerrum) bzw. perimetrische Untersuchung nach Förster durchgeführt. Der Untersuchungsablauf erforderte wiederholte Messungen und Abgleich mit der Anamnese (z. B. Kopfschmerzen, Neurologie-Vorstellung). Der dokumentierte Befund dient der weiteren Abklärung und Verlaufskontrolle.";

const B1225_KINDER =
  "Gesichtsfeldprüfung bei eingeschränkter Kooperation (Kleinkind/Schulkind): Die Messung gestaltete sich zeitaufwändig; es waren mehrere Erklärungsschritte, Pausen und Wiederholungen erforderlich, bis verlässliche Reizschwellen bzw. reproduzierbare Antworten vorlagen. Die erbrachte Leistung entspricht GOÄ 1225; der erhöhte Zeitaufwand ist durch die Dokumentation der Messphasen und Wiederholungen nachvollziehbar.";

const B1225_REGELHOECHST =
  "Kampimetrie (Bjerrum) bzw. Perimetrie nach Förster zur Beurteilung des zentralen Gesichtsfeldes; Leistung entsprechend GOÄ 1225 erbracht. Abrechnung zum Regelhöchstsatz (Faktor 2,3). Eine gesonderte Begründung für den Steigerungsfaktor ist bei Abrechnung bis zum Schwellenwert nicht erforderlich; Anlass und technischer Ablauf ergeben sich aus der Akte.";

const B1225_STEIGERUNG =
  "Kampimetrie/Perimetrie nach GOÄ 1225. Der Untersuchungsablauf war gegenüber dem Regelfall deutlich erschwert: mehrfache Messreihen wegen schwankender Konzentration bzw. Ermüdung, erneute Kalibrierung und Nachmessungen bei grenzwertigen oder widersprüchlichen Erstbefunden sowie erhöhter Erklärungs- und Betreuungsaufwand bis zur belastbaren Auswertung. Aus diesem Grund wird die Berechnung über dem Regelhöchstsatz als sachgerecht und im Einzelfall angemessen erachtet.";

const B1_KOMPLEX =
  "Eingehende ärztliche Beratung nach GOÄ 1 bei multimorbidem Patienten mit mehreren internistischen Risikofaktoren und laufender Mehrfachmedikation. Es erfolgte die strukturierte Abklärung des aktuellen Beschwerdebildes, Abstimmung von Indikationen und Kontraindikationen sowie Erörterung von Nebenwirkungen und Wechselwirkungen; die Beratung umfasste die Koordination weiterer diagnostischer und therapeutischer Schritte. Der zeitliche Umfang überstieg den einer durchschnittlichen Kurzberatung deutlich; die Gesprächsdauer und die inhaltlichen Schwerpunkte sind in der Dokumentation festgehalten.";

const B1_AUFKL =
  "Ausführliche Beratung nach GOÄ 1 mit umfassender Aufklärung zu Diagnoseaussagen, Prognose und Therapieoptionen einschließlich Risiken, Nutzen und Alternativen. Der Patient brachte zahlreiche Rückfragen; es war mehrfache Verständnissicherung und schrittweise Erörterung erforderlich, bis ein informierter Entscheidungsprozess dokumentiert werden konnte. Aus diesem Grund wird die Abrechnung über dem Regelhöchstsatz als nachvollziehbar begründet.";

const B1_SPRACHE =
  "Beratung nach GOÄ 1 unter erschwerten Kommunikationsbedingungen (eingeschränkte deutsche Sprachkenntnisse bzw. notwendige vereinfachte Darstellung komplexer Sachverhalte). Der Gesprächsverlauf war zeitintensiver, da Inhalte wiederholt erklärt und in kleineren Schritten abgesichert werden mussten, bis eine belastbare Einigung über das weitere Vorgehen bestand. Der Mehraufwand ergibt sich aus dem dokumentierten Beratungsablauf.";

const B1_REGELHOECHST =
  "Ärztliche Beratung nach GOÄ 1 (auch mittels Fernsprecher); Leistung erbracht, Abrechnung zum Regelhöchstsatz (Faktor 2,3). Eine gesonderte Begründung für den Steigerungsfaktor ist bei Abrechnung bis zum Schwellenwert nicht erforderlich; Anlass und Gesprächsinhalt ergeben sich aus der Patientenakte.";

const B1_STEIGERUNG =
  "Beratung nach GOÄ 1 mit erhöhtem Zeitaufwand: das Gespräch dauerte voraussichtlich deutlich länger als eine typische Standardberatung, da mehrere eigenständige Problemstellungen nacheinander erörtert wurden (u. a. Akutbeschwerden, Langzeitmedikation, Verlaufsplanung) und wiederholte Rückfragen des Patienten bzw. der Patientin zu klären waren. Die Abrechnung über dem Regelhöchstsatz wird daher als sachgerecht angesehen; die ungefähre Gesprächsdauer ist in der Akte vermerkt.";

const MAP: Record<string, readonly string[]> = {
  "1": [B1_KOMPLEX, B1_AUFKL, B1_SPRACHE, B1_REGELHOECHST, B1_STEIGERUNG],
  "1207": [B1207_GLEITSICHT, B1207_PRISMEN, B1207_NAHSCHMERZ, B1207_REGELHOECHST, B1207_STEIGERUNG],
  "1225": [B1225_GLUKOM, B1225_NEURO, B1225_KINDER, B1225_REGELHOECHST, B1225_STEIGERUNG],
};

/** Entspricht der Beratungslogik in `regelengine.ts` (ca. 15–20 Min. eingehende Beratung). */
export const DEFAULT_BERATUNG_MINUTEN_PHRASE = "15–20 Minuten";

export type BegruendungBeispieleOpts = {
  /** Rotation für „Neu generieren“ (wechselt die drei aus einem größeren Pool). */
  rotation?: number;
  quelleText?: string;
  begruendung?: string;
  anmerkung?: string;
};

/** GOÄ 1–4 (Beratung): numerische Ziffer 1–4, optional mit Buchstaben-Suffix. */
export function isBeratungsZiffer(ziffer: string): boolean {
  const n = parseInt(String(ziffer ?? "").replace(/\D/g, ""), 10) || 0;
  return n >= 1 && n <= 4;
}

/**
 * Extrahiert eine Minutenangabe aus Freitext (Quelle, Begründung, Anmerkung).
 * Liefert z. B. "18 Minuten" oder "15–20 Minuten".
 */
export function extractBeratungsMinutenAusText(...sources: (string | undefined)[]): string | undefined {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return undefined;
  const rangeRe =
    /\b(?:ca\.?\s*)?(\d{1,2})\s*[–\-]\s*(\d{1,2})\s*(?:Min|Minuten|min)\b/i;
  const m1 = text.match(rangeRe);
  if (m1) return `${m1[1]}–${m1[2]} Minuten`;
  const singleRe = /\b(?:ca\.?\s*)?(\d{1,2})\s*(?:Min|Minuten|min)\b/i;
  const m2 = text.match(singleRe);
  if (m2) return `${m2[1]} Minuten`;
  return undefined;
}

function beratungsMinutenEinleitung(ziffer: string, opts: BegruendungBeispieleOpts): string {
  if (!isBeratungsZiffer(ziffer)) return "";
  const parsed = extractBeratungsMinutenAusText(opts.quelleText, opts.begruendung, opts.anmerkung);
  const phrase = parsed ?? DEFAULT_BERATUNG_MINUTEN_PHRASE;
  return `Die Gesprächsdauer wurde im vorliegenden Dokument mit ca. ${phrase} bezogen (GOÄ-Abrechnungspraxis eingehende Beratung, GOÄ 1–4). `;
}

/** Wählt drei Einträge aus einer Liste; bei n>3 Fenster-Rotation, bei n===3 zyklische Permutation. */
export function pickThreeFromPool<T>(list: readonly T[], rotation: number): T[] {
  const n = list.length;
  const rot = Math.max(0, Math.floor(rotation));
  if (n === 0) return [];
  if (n <= 3) {
    if (n < 3) return [...list];
    const r = rot % 3;
    return [list[r]!, list[(r + 1) % 3]!, list[(r + 2) % 3]!];
  }
  const out: T[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(list[(rot * 3 + i) % n]!);
  }
  return out;
}

/**
 * Liefert genau drei vollständige Begründungstexte für die angegebene GOÄ-Ziffer.
 * Bei Beratungsziffern (1–4) wird eine Minutenbezugnahme vorangestellt (aus Quelle/Begründung/Anmerkung oder Standard 15–20 Min.).
 */
function beratungVorlagenListe(ziffer: string): readonly string[] | undefined {
  const z = String(ziffer ?? "").trim().replace(/^A/i, "");
  const own = MAP[z];
  if (own?.length) return own;
  if (isBeratungsZiffer(z) && MAP["1"]?.length) return MAP["1"];
  return undefined;
}

function adaptBeratungGoaeZifferInText(text: string, ziffer: string): string {
  const z = String(ziffer ?? "").trim().replace(/^A/i, "");
  if (z === "1" || !isBeratungsZiffer(z)) return text;
  return text.replace(/\bGOÄ 1\b/g, `GOÄ ${z}`);
}

export function getBegruendungBeispiele(
  ziffer: string,
  faktor: number,
  opts?: BegruendungBeispieleOpts,
): string[] {
  void faktor;
  const z = String(ziffer ?? "").trim().replace(/^A/i, "");
  const list = beratungVorlagenListe(z);
  const rotation = opts?.rotation ?? 0;
  if (!list?.length) return [];
  const picked = pickThreeFromPool(list, rotation).map((t) => adaptBeratungGoaeZifferInText(t, z));
  const ein = beratungsMinutenEinleitung(z, opts ?? {});
  if (!ein) return picked;
  return picked.map((t) => ein + t);
}

export type BegruendungBeispielePositionInput = {
  ziffer: string;
  faktor: number;
  quelleText?: string;
  begruendung?: string;
  anmerkung?: string;
  begruendungBeispiele?: string[];
};

/**
 * Drei Vorschläge für die UI: zuerst kanonische Vorlagen, sonst (max.) drei aus dem LLM-Array mit Rotation.
 */
export function getBegruendungBeispieleTriple(
  p: BegruendungBeispielePositionInput,
  rotation = 0,
): string[] {
  const canon = getBegruendungBeispiele(p.ziffer, p.faktor, {
    rotation,
    quelleText: p.quelleText,
    begruendung: p.begruendung,
    anmerkung: p.anmerkung,
  });
  if (canon.length > 0) return canon;
  return pickThreeFromPool(p.begruendungBeispiele ?? [], rotation);
}

/**
 * Ein ausformulierter Beispielabsatz für die Akte, wenn keine ziffernspezifischen Vorlagen in der UI stehen
 * (Engine 3: Steigerung über Schwelle ohne `begruendungBeispiele`-Liste).
 */
export function getSteigerungFallbackBeispiel(params: {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betragFormatted: string;
  quelleText?: string;
}): string {
  const z = String(params.ziffer ?? "").trim();
  const bez = String(params.bezeichnung ?? "").trim();
  const f = String(params.faktor).replace(".", ",");
  const kopf = `GOÄ ${z}${bez ? ` (${bez})` : ""} · Faktor ${f} (Betrag ${params.betragFormatted}).`;
  const min = extractBeratungsMinutenAusText(params.quelleText);
  const minTeil = min
    ? ` Konkret ist die Gesprächsdauer im Dokument mit ca. ${min} bezogen.`
    : isBeratungsZiffer(z)
      ? ` Konkret ist die Gesprächsdauer im Dokument mit ca. ${DEFAULT_BERATUNG_MINUTEN_PHRASE} (eingehende Beratung, GOÄ-üblich) zu dokumentieren.`
      : "";
  return (
    `${kopf} Erhöhter Zeitaufwand und besondere Schwierigkeit bei der Durchführung der genannten Leistung: Es waren ` +
    `mehrfache Erklärungsschritte, wiederholte Messungen bzw. Anpassungen und eine ausführlichere Erfassung als im Regelfall üblich erforderlich, bis ein belastbares Ergebnis für die weitere Behandlung vorlag.${minTeil} ` +
    `Medizinischer Anlass und konkrete Erschwernis sind im Behandlungsverlauf dokumentiert.`
  );
}
