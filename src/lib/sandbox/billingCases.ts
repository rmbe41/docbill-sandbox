import type {
  EncounterType,
  InsuranceType,
  SandboxBillingCase,
  SandboxBillingCaseDocumentation,
  SandboxInvoice,
  TimelineEntry,
  HighlightSnippet,
  ServiceItemGoae,
  ServiceItemEbm,
} from "./types";
import { billingBasisFromInsurance } from "./types";
import { invoicePresentationPatch } from "./invoicePresentation";
import { goaeV2CodeById } from "@/data/goae-catalog-v2";
import {
  finalizeEbmToTarget,
  finalizeGoaeToTarget,
  r2,
  serviceItemEbm,
  serviceItemGoae,
} from "./sandboxTariff";

export const SANDBOX_BILLING_CASE_COUNT = 50;

/** Untergrenze der festen Zieltabelle [€] für jeden Sandbox-Fall — EBM- und GOÄ-Spur werden hieran ausgerichtet */
export const SANDBOX_BILLING_INVOICE_MIN_EUR = 75;

/** Obergrenze der festen Zieltabelle [€] */
export const SANDBOX_BILLING_INVOICE_MAX_EUR = 5900;

/**
 * Feste Zieltabelle: Index 0 → 75 €, Index CASE_COUNT−1 → 5900 € (linear, gerundet).
 * Rechnungszeilen sind reine Katalogbeträge (`ebm-catalog-2026-q2`, `goae-catalog-v2` + Punktwert wie Regelengine).
 */
export function sandboxBillingTargetEuroForCaseIndex(i: number): number {
  const n = SANDBOX_BILLING_CASE_COUNT;
  if (n <= 1) return SANDBOX_BILLING_INVOICE_MIN_EUR;
  return Math.round(
    SANDBOX_BILLING_INVOICE_MIN_EUR +
      ((SANDBOX_BILLING_INVOICE_MAX_EUR - SANDBOX_BILLING_INVOICE_MIN_EUR) * i) / (n - 1),
  );
}

type GoaeTpl = { code: string; factor: number; factor_justification?: string };

type TemplateDef = {
  difficulty: SandboxBillingCase["difficulty"];
  encounter_type: EncounterType;
  anamnesis: string;
  findings: string;
  diagnosis_text: string;
  therapy: string;
  highlights?: HighlightSnippet[];
  /** KBV-GOPs aus dem DocBill EBM-Katalog (`src/data/ebm-catalog-2026-q2.json`) */
  ebmGops: readonly string[];
  /** GOÄ aus `goae-catalog-v2`; Faktor nur zwischen Schwelle und Max; bei Faktor über Schwelle: Begründung (GOÄ) */
  goaeLines: readonly GoaeTpl[];
};

/** 15 Augenheilkunde-Vorlagen: klinischer Text bleibt, Abrechnung fest aus Katalogen abgeleitet */
const TEMPLATES: TemplateDef[] = [
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis:
      "Seit 4 Tagen zunehmend rotes, juckendes linkes Auge, morgens verklebt. Keine Schmerzen, Sehvermögen nahezu unverändert.",
    findings: "Biomikroskopie: mäßige papilläre Hyperämie, kein Hornhautinfiltrat, Vorderkammer frei.",
    diagnosis_text: "Akute bakterielle Konjunktivitis links.",
    therapy: "Antibiotische Augentropfen, Kühlkompresse, Hygienehinweise.",
    highlights: [{ field: "findings", snippet: "papilläre Hyperämie", ref: "1240" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      {
        code: "1",
        factor: 2.5,
        factor_justification:
          "Ausführliche problemorientierte Beratung und Aufklärung bei akuter Entzündung; erhöhter Zeitaufwand.",
      },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Besondere Schwierigkeit bei Spaltlampenuntersuchung durch verklebte Lidbacke links und häufiges Blinzeln; zusätzlicher Zeitaufwand.",
      },
      { code: "1241", factor: 2.3 },
    ],
  },
  {
    difficulty: "easy",
    encounter_type: "Folge",
    anamnesis: "Bekannte Pollenallergie; beide Augen tränen und brennen im Frühjahr, Kontaktlinsen derzeit nicht getragen.",
    findings: "Beidseits feine papilläre Falten Unterlid, keine Hornhautbeteiligung.",
    diagnosis_text: "Chronische allergische Konjunktivitis.",
    therapy: "Mastzellstabilisator und Antihistaminikum topisch, Kältekompressen.",
    highlights: [{ field: "anamnesis", snippet: "Pollenallergie", ref: "03230" }],
    ebmGops: ["03230", "06333", "06330"],
    goaeLines: [
      { code: "1", factor: 2.3 },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Erschwerte Beurteilung bei beidseitigem Juckreiz und Tränentrübung; erhöhter Zeitaufwand für differenzierte Befunddokumentation.",
      },
      { code: "1241", factor: 2.3 },
    ],
  },
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis: "Seit Monaten Fremdkörpergefühl beidseits, Bildschirmarbeit >8 h; gelegentlich Brennen.",
    findings: "SPK leicht fleckig, Tränenfilm unstabil in der Spaltlampe, keine Infektzeichen.",
    diagnosis_text: "Keratopathia filiformis bei Sicca-Symptomatik.",
    therapy: "Konservierung, hyaluronsäurehaltige Tränenersatzmittel, Lidhygiene.",
    highlights: [{ field: "findings", snippet: "Tränenfilm unstabil", ref: "1240" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      { code: "1", factor: 2.3 },
      {
        code: "1240",
        factor: 2.5,
        factor_justification:
          "Zusätzlicher Aufwand bei Beurteilung von Tränenfilm und oberflächlichen Hornhautveränderungen mit Kalibrierung der Spaltlampe.",
      },
    ],
  },
  {
    difficulty: "easy",
    encounter_type: "Vorsorge",
    anamnesis: "50. Lebensjahr, Augencheck ohne Beschwerden, kontrollierte arterielle Hypertonie.",
    findings: "Visus beidseits 1,0 mit Korrektur; Papillen scharf, ZNÖ approx. 0,35–0,45.",
    diagnosis_text: "Alterspresbyopie, strukturierte Alterssichtprüfung.",
    therapy: "Lesebrillenrezept; nächstes Screening in 2 Jahren.",
    highlights: [{ field: "findings", snippet: "1,0 mit Korrektur", ref: "06333" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      {
        code: "3",
        factor: 2.5,
        factor_justification:
          "Eingehende Untersuchung im Rahmen der strukturierten Alterssichtprüfung mit erweiterter Erörterung der Befunde und Risikohinweise.",
      },
      { code: "1240", factor: 2.3 },
      { code: "1241", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Erstkontakt",
    anamnesis: "Unschärfe im zentralen Gesichtsfeld rechtlich seit Wochen, Metamorphopsien verneint.",
    findings: "Makula trocken, Drusen mittlerer Größe, OCT ohne Flüssigkeit.",
    diagnosis_text: "Altersbedingte Makuladegeneration (trockene AMD), beidseits.",
    therapy: "AREDS-Empfehlung besprechen, Verlauf OCT in 6 Monaten.",
    highlights: [{ field: "findings", snippet: "Drusen mittlerer Größe", ref: "06336" }],
    ebmGops: ["03230", "06333", "06336"],
    goaeLines: [
      {
        code: "3",
        factor: 2.5,
        factor_justification:
          "Erhöhter Zeitaufwand bei einzelfeldbezogener Anamnese und Abgrenzung visuell relevanter Makulabefunde.",
      },
      {
        code: "1240",
        factor: 2.5,
        factor_justification:
          "Umfangreiche biomikroskopische Beurteilung zentraler und peripherer Anteile mit Fokus auf Makularegion; besondere Sorgfalt.",
      },
      { code: "1241", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Glaukomverdacht, Augendruck zuletzt grenzwertig, Familienanamnese positiv.",
    findings: "IOP 23/24 mmHg Goldmann, Papille ISNT asymmetrisch, RNFL-Ausdünnung inferior temporal.",
    diagnosis_text: "Okulärer Hypertonus / Verdacht auf Offenwinkelglaukom.",
    therapy: "Prostanalog beginnen, Verlauf 4 Wochen.",
    highlights: [{ field: "findings", snippet: "IOP 23/24", ref: "06330" }],
    ebmGops: ["03230", "06333", "06330"],
    goaeLines: [
      { code: "1", factor: 2.3 },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Ausführliche papillenkritische Bewertung inklusive Beurteilung des Nervenfaserschichtprofils unter erschwerten Reflexbedingungen; Mehraufwand.",
      },
      { code: "1241", factor: 2.3 },
      { code: "1243", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Diabetes mellitus Typ 2; jährliches diabetisches Augenscreening fällig.",
    findings: "Keine proliferative Retinopathie; wenige Mikroaneurysmen temporal inferi temporal.",
    diagnosis_text: "Leichte nicht proliferative diabetische Retinopathie.",
    therapy: "Strikte Einstellung, Wiederholung in 12 Monaten, Hinweis Augenarzt bei Sehstörungen.",
    highlights: [{ field: "findings", snippet: "Mikroaneurysmen", ref: "06333" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      { code: "1", factor: 2.3 },
      {
        code: "1240",
        factor: 2.5,
        factor_justification:
          "Systematische peripher-kritische Mitbeurteilung bei diabetischem Screening; erhöhter Zeitaufwand zur Läsionszuordnung.",
      },
      { code: "1241", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Erstkontakt",
    anamnesis: "Beidseits verschwommenes Sehen seit zwei Wochen, neue Stärke vermutet.",
    findings: "Hornhaut klar, beginnend triebige Linse beidseits, Visus ohne Korrektur reduziert.",
    diagnosis_text: "Alterstar (Katarakt) beidseits — OP-Indikation Abklärung.",
    therapy: "Biometrie- und OP-Termin koordiniert.",
    highlights: [{ field: "findings", snippet: "triebige Linse", ref: "1240" }],
    ebmGops: ["03230", "06333", "06340"],
    goaeLines: [
      {
        code: "3",
        factor: 2.8,
        factor_justification:
          "Eingehende Abklärung beidseits mit Visus-Korrelation und OP-Indikationserörterung; erhöhter zeitlicher Aufwand.",
      },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Erschwerte Beurteilung der Linsentransparenz und vorderen Abschnitte bei beginnender Triebung; zusätzliche Kalibrierung und Dokumentation.",
      },
      { code: "1241", factor: 2.3 },
      { code: "1243", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Notfall",
    anamnesis: "Plötzlich rot schmerzendes Auge, Übelkeit, Sehkraft links stark vermindert seit heute Morgen.",
    findings: "Mittelweit, Ödem Hornhaut, IOP 48 mmHg links, flache Vorderkammer DD Winkelblock.",
    diagnosis_text: "Akutes Winkelblockglaukom links.",
    therapy: "Notfalltherapie: pilocarpinähnlich, Azetazolamid, Laseriridotomie Anmeldung.",
    highlights: [{ field: "findings", snippet: "IOP 48 mmHg", ref: "1256" }],
    ebmGops: ["03230", "06333", "01701"],
    goaeLines: [
      {
        code: "1",
        factor: 3.2,
        factor_justification:
          "Notfallversorgung mit sofortiger Verfügbarkeit, priorisierte Abklärung und intensive Aufklärung über Akuttherapie und weiteres Vorgehen.",
      },
      {
        code: "1240",
        factor: 2.8,
        factor_justification:
          "Akut erschwerte Spaltlampenuntersuchung bei Hornhautödem, Photophobie und massiver Hyperämie; erhöhter Zeitaufwand.",
      },
      {
        code: "1256",
        factor: 2.5,
        factor_justification:
          "Mehrfache Applanationstonometrie bei erschwerten Messbedingungen (Hornhautödem, fehlende Kooperation); zusätzlicher Aufwand.",
      },
      {
        code: "1244",
        factor: 2.4,
        factor_justification:
          "Zusatzaufwand bei Exophthalmometrie im Notfallkontext zur Verlaufsdokumentation.",
      },
    ],
  },
  {
    difficulty: "hard",
    encounter_type: "Folge",
    anamnesis: "Nach Katarakt-OP rechtlich leichte Unschärfe und Flimmern; OP vor 3 Wochen.",
    findings: "Hinterkapsel klar, kein Ödem Makula in OCT, IOL zentriert.",
    diagnosis_text: "Zustand nach Phakoemulsifikation re — Verlauf ohne Komplikation.",
    therapy: "NSAR-topisch auslaufen lassen, nächste Kontrolle 6 Wo.",
    highlights: [{ field: "anamnesis", snippet: "Nach Katarakt-OP", ref: "06340" }],
    ebmGops: ["03230", "06333", "06340"],
    goaeLines: [
      {
        code: "1",
        factor: 2.5,
        factor_justification:
          "Erweiterte Beratung zu postoperativen Symptomen, Medikation und Verlaufskontrolle; Mehraufwand.",
      },
      { code: "1240", factor: 2.3 },
      { code: "1241", factor: 2.3 },
      { code: "1244", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Vorsorge",
    anamnesis: "Kinderuntersuchung, Eltern vermuten intermittierendes Schielen.",
    findings: "Alternierendes intermittierendes Exotropie bei Ermüdung, Stereo mind. 400″.",
    diagnosis_text: "Intermittierendes Schielen — Überwachung.",
    therapy: "Orthoptik-Termin, keine Operation indiziert zurzeit.",
    highlights: [{ field: "findings", snippet: "intermittierendes Exotropie", ref: "03230" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      { code: "3", factor: 2.3 },
      {
        code: "1240",
        factor: 2.5,
        factor_justification:
          "Zusätzlicher Aufwand bei kindgerechter Untersuchung und Kooperationssteuerung in der Spaltlampe.",
      },
      { code: "1", factor: 2.3 },
    ],
  },
  {
    difficulty: "hard",
    encounter_type: "Erstkontakt",
    anamnesis: "Lichtblitze und „Schleier“ temporal rechts seit 2 Tagen, Myopie hoch.",
    findings: "Weisslich hinterlegende Netzhautperipherie rechts, kein Makulaforamen — dringende Laserindikation geklärt.",
    diagnosis_text: "Netzhautabhebung rechts — Frühstadium.",
    therapy: "Notfall-Laserretinopexie / Vitrektomie-Anmeldung extern.",
    highlights: [{ field: "anamnesis", snippet: "Lichtblitze", ref: "06336" }],
    ebmGops: ["03230", "06336", "06337", "06330"],
    goaeLines: [
      {
        code: "3",
        factor: 3.2,
        factor_justification:
          "Notfallmäßige einzelfeldbezogene Abklärung bei Verdacht auf Netzhautforamina/Abhebung; hoher Erörterungs- und Dokumentationsaufwand.",
      },
      {
        code: "1240",
        factor: 2.8,
        factor_justification:
          "Erschwerte peripher-kritische Beurteilung bei hoher Myopie und Verdachtsbefund; erhöhter Zeitaufwand.",
      },
      {
        code: "1257",
        factor: 2.5,
        factor_justification:
          "Serielle tonometrische Kurvenmessung bei instabiler Situation und Notfallcharakter; Mehraufwand.",
      },
      { code: "1244", factor: 2.3 },
    ],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Grauer Star OP-Vorbereitung; Biometrie liegt vor.",
    findings: "Korneadurchmesser und Achslängen im Normbereich, keine Makulapathologie in OCT.",
    diagnosis_text: "Katarakt beidseits — elektive OP Planung.",
    therapy: "Linsenwahl besprochen, Prämedikationsplan.",
    highlights: [{ field: "anamnesis", snippet: "OP-Vorbereitung", ref: "06340" }],
    ebmGops: ["03230", "06333", "06340"],
    goaeLines: [
      {
        code: "1",
        factor: 2.5,
        factor_justification:
          "Ausführliche OP-Vorbereitung mit Wahl der Linsenoptik und Risikoaufklärung; erhöhter Beratungsaufwand.",
      },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Umfangreiche biomikroskopische Beurteilung bei OP-Planung inklusive Zentrierungs- und Befunddokumentation.",
      },
      { code: "1241", factor: 2.3 },
      {
        code: "3",
        factor: 2.5,
        factor_justification:
          "Eingehende Statuserhebung unmittelbar vor elektivem Eingriff mit Abstimmung der Befunde zur Biometrie.",
      },
    ],
  },
  {
    difficulty: "hard",
    encounter_type: "Folge",
    anamnesis: "Zentrales Skotom links nach arteriellem Verschluss — Verlauf unter Therapie.",
    findings: "Pallor papillomakulärer Bündel, Gesichtsfeld zentral ausgefallen.",
    diagnosis_text: "Ischämische Optikusneuropathie links (DD AION).",
    therapy: "Internistische Risikofaktoren; neuroophthalmologische Mitbehandlung.",
    highlights: [{ field: "findings", snippet: "Gesichtsfeld", ref: "06330" }],
    ebmGops: ["03230", "06333", "06330"],
    goaeLines: [
      {
        code: "3",
        factor: 3.2,
        factor_justification:
          "Hochkomplexe neuroophthalmologische Einordnung bei zentralem Skotom und Papillenbeteiligung; erheblicher Zeitaufwand.",
      },
      {
        code: "1240",
        factor: 2.8,
        factor_justification:
          "Erschwerte papillenkritische Bewertung bei ausgefallenem zentralen Gesichtsfeld; zusätzlicher Dokumentationsaufwand.",
      },
      {
        code: "1244",
        factor: 2.4,
        factor_justification:
          "Zusatzmessung zur Verlaufsbeobachtung im Rahmen der akuten Schluckung bei erschwerter Ausgangslage.",
      },
      { code: "1241", factor: 2.3 },
      {
        code: "1256",
        factor: 2.5,
        factor_justification:
          "Mehrfache Tonometrie bei therapieabhängigen Druckschwankungen und eingeschränkter Kooperation.",
      },
    ],
  },
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis: "Rechts Schlagsahne-Veratzung Konjunktiva vor 24 h, starkes Brennen.",
    findings: "Chemische Konjunktivitis, pH neutralisiert, epitheliale Erosion lateral inferior.",
    diagnosis_text: "Verätzung der Konjunktiva und Kornea durch Chemikalie.",
    therapy: "Spülprotokoll, antibiotische Salbe, engmaschige Kontrolle.",
    highlights: [{ field: "findings", snippet: "epitheliale Erosion", ref: "1240" }],
    ebmGops: ["03230", "06333"],
    goaeLines: [
      {
        code: "1",
        factor: 2.5,
        factor_justification:
          "Ausführliche Akutaufklärung zu Verätzung, Spülhinweisen und weiterem Notfallmanagement; erhöhter Zeitaufwand.",
      },
      {
        code: "1240",
        factor: 2.6,
        factor_justification:
          "Erschwerte Spaltlampenbeurteilung bei Schmerz, Lichtscheu und Fluoreszein-Anwendung; besondere Sorgfalt.",
      },
      { code: "1243", factor: 2.3 },
    ],
  },
];

export function buildBillingCases(): SandboxBillingCase[] {
  const out: SandboxBillingCase[] = [];
  for (let i = 0; i < SANDBOX_BILLING_CASE_COUNT; i++) {
    const t = TEMPLATES[i % TEMPLATES.length]!;
    const target = sandboxBillingTargetEuroForCaseIndex(i);
    const n = i + 1;
    const suffix = ` — Fall ${n}`;
    const doc: SandboxBillingCaseDocumentation = {
      encounter_type: t.encounter_type,
      anamnesis: t.anamnesis + suffix,
      findings: t.findings,
      diagnosis_text: t.diagnosis_text,
      therapy: t.therapy,
    };

    const seedEbm = t.ebmGops.map(serviceItemEbm).filter((x): x is ServiceItemEbm => Boolean(x));
    const service_items_ebm = finalizeEbmToTarget(seedEbm, target);

    const goaeTpl = t.goaeLines.map((row) => ({ ...row }));
    if (i % 11 === 5 && goaeTpl.length > 0) {
      const first = goaeTpl[0]!;
      const meta = goaeV2CodeById.get(first.code);
      if (meta) {
        const f = Math.min(meta.fee.maxFactor, first.factor + 0.2);
        const elevated = f > meta.fee.thresholdFactor + 0.009;
        goaeTpl[0] = {
          code: first.code,
          factor: f,
          ...(elevated || first.factor_justification?.trim()
            ? {
                factor_justification:
                  first.factor_justification?.trim() ||
                  `Anhebung gegenüber Schwelle (${meta.fee.thresholdFactor.toFixed(2).replace(".", ",")}): erhöhter Beratungs- und Dokumentationsaufwand (Demovariante).`,
              }
            : {}),
        };
      }
    }
    const seedGo = goaeTpl
      .map((l) => serviceItemGoae(l.code, l.factor, l.factor_justification))
      .filter((x): x is ServiceItemGoae => Boolean(x));
    const service_items_goae = finalizeGoaeToTarget(seedGo, target);

    let difficulty: SandboxBillingCase["difficulty"] = t.difficulty;
    if (i % 17 === 0 || i % 19 === 0) difficulty = "hard";
    else if (i % 5 === 0 || i % 7 === 0 || i % 3 === 0) difficulty = "medium";
    else if (t.difficulty === "easy") difficulty = "easy";

    out.push({
      id: `sb-case-${String(n).padStart(3, "0")}`,
      difficulty,
      documentation: doc,
      highlights: t.highlights,
      service_items_ebm,
      service_items_goae,
      total_amount: r2(target),
      meta: { notes: `Fall sb-case-${String(n).padStart(3, "0")} · Vorlage ${(i % TEMPLATES.length) + 1}` },
    });
  }
  return out;
}

export const BILLING_CASES: SandboxBillingCase[] = buildBillingCases();

export function pickBillingCaseIndex(docId: string, patientId: string, diagnosisText: string): number {
  let h = 0;
  const s = `${docId}:${patientId}:${diagnosisText}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % BILLING_CASES.length;
}

export function pickBillingCaseForDoc(docId: string, patientId: string, diagnosisText: string): SandboxBillingCase {
  return BILLING_CASES[pickBillingCaseIndex(docId, patientId, diagnosisText)]!;
}

export function invoiceFromCase(
  invoiceId: string,
  docId: string,
  patientId: string,
  c: SandboxBillingCase,
  initialStatus: SandboxInvoice["status"],
  insuranceType: InsuranceType,
): SandboxInvoice {
  const timeline: TimelineEntry[] = [
    { ts: new Date().toISOString(), event: "Abrechnungsvorschlag geladen", actor: "System" },
  ];
  const billing_basis = billingBasisFromInsurance(insuranceType);
  const service_items_ebm =
    billing_basis === "statutory" ? c.service_items_ebm.map((x) => ({ ...x })) : [];
  const service_items_goae =
    billing_basis === "private" ? c.service_items_goae.map((x) => ({ ...x })) : [];
  const base: SandboxInvoice = {
    id: invoiceId,
    documentation_id: docId,
    patient_id: patientId,
    billing_basis,
    service_items_ebm,
    service_items_goae,
    total_amount: 0,
    status: initialStatus,
    timeline,
    billing_difficulty: c.difficulty,
    confidence_tier: "high",
    confidence_percent: 90,
    card_code_summary: "",
  };
  return { ...base, ...invoicePresentationPatch(base) };
}
