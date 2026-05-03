import type {
  ConfidenceLevel,
  DiagnosisRow,
  EncounterType,
  SandboxBillingCase,
  SandboxBillingCaseDocumentation,
  ServiceItemEbm,
  ServiceItemGoae,
  HighlightSnippet,
  SandboxInvoice,
  TimelineEntry,
} from "./types";
import { invoicePresentationPatch } from "./invoicePresentation";
import goaeMock from "@/data/sandbox/goae-mock.json";
import ebmMock from "@/data/sandbox/ebm-mock.json";

const OW = 12.7404 / 100;

function mkGoae(code: string, factor: number): ServiceItemGoae {
  const row = (goaeMock as { code: string; label: string; defaultEuro?: number }[]).find((r) => r.code === code);
  const base = row?.defaultEuro ?? 15;
  const amount = Math.round(base * factor * 100) / 100;
  return { code, label: row?.label ?? `GOÄ ${code}`, factor, amount };
}

function ebm(code: string): ServiceItemEbm {
  const row = (ebmMock as { code: string; label: string; points?: number }[]).find((r) => r.code === code);
  const pts = row?.points ?? 100;
  const amount_eur = Math.round(pts * OW * 100) / 100;
  return { code, label: row?.label ?? `EBM ${code}`, points: pts, amount_eur };
}

function dx(
  code: string,
  label: string,
  confidence: ConfidenceLevel,
  rationale: string,
  source_snippet?: string,
): DiagnosisRow {
  return { code, label, confidence, rationale, source_snippet };
}

type TemplateDef = {
  difficulty: SandboxBillingCase["difficulty"];
  encounter_type: EncounterType;
  anamnesis: string;
  findings: string;
  diagnosis_text: string;
  therapy: string;
  highlights?: HighlightSnippet[];
  diagnosis_codes: DiagnosisRow[];
  service_items_ebm: ServiceItemEbm[];
  service_items_goae: ServiceItemGoae[];
};

/** 15 Augenheilkunde-Templates (Sandbox); Beträge werden auf Zielspanne skaliert. */
const TEMPLATES: TemplateDef[] = [
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis:
      "Seit 4 Tagen zunehmend rotes, juckendes linkes Auge, morgens verklebt. Keine Schmerzen, Sehvermögen nahezu unverändert.",
    findings: "Biomikroskopie: mäßige papilläre Hyperämie, kein Hornhautinfiltrat, Vorderkammer frei.",
    diagnosis_text: "Akute bakterielle Konjunktivitis links.",
    therapy: "Antibiotische Augentropfen, Kühlkompresse, Hygienehinweise.",
    highlights: [{ field: "findings", snippet: "papilläre Hyperämie", ref: "H10.9" }],
    diagnosis_codes: [
      dx("H10.9", "Konjunktivitis, nicht näher bezeichnet", "high", "klassisches Bild ohne Hornhautkomplikation"),
    ],
    service_items_ebm: [ebm("21001"), ebm("21002")],
    service_items_goae: [mkGoae("1", 2.3), mkGoae("1240", 2.3), mkGoae("1241", 1.0)],
  },
  {
    difficulty: "easy",
    encounter_type: "Folge",
    anamnesis: "Bekannte Pollenallergie; beide Augen tränen und brennen im Frühjahr, Kontaktlinsen derzeit nicht getragen.",
    findings: "Beidseits feine papilläre Falten Unterlid, keine Hornhautbeteiligung.",
    diagnosis_text: "Chronische allergische Konjunktivitis.",
    therapy: "Mastzellstabilisator und Antihistaminikum topisch, Kältekompressen.",
    highlights: [{ field: "anamnesis", snippet: "Pollenallergie", ref: "H10.1" }],
    diagnosis_codes: [
      dx("H10.1", "Akute atrophische Konjunktivitis — allergische Konjunktivitis", "high", "Saisonalität und Befund"),
    ],
    service_items_ebm: [ebm("21001"), ebm("21003")],
    service_items_goae: [mkGoae("5", 2.3), mkGoae("1240", 2.0), mkGoae("1241", 1.0)],
  },
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis: "Seit Monaten Fremdkörpergefühl beidseits, Bildschirmarbeit >8 h; gelegentlich Brennen.",
    findings: "SPK leicht fleckig, Tränenfilm unstabil in der Spaltlampe, keine Infektzeichen.",
    diagnosis_text: "Keratopathia filiformis bei Sicca-Symptomatik.",
    therapy: "Konservierung, hyaluronsäurehaltige Tränenersatzmittel, Lidhygiene.",
    diagnosis_codes: [dx("H16.8", "Sonstige Keratitis", "medium", "Oberflächenbefund ohne Infekt")],
    service_items_ebm: [ebm("21002"), ebm("21004")],
    service_items_goae: [mkGoae("1", 2.3), mkGoae("1240", 2.3)],
  },
  {
    difficulty: "easy",
    encounter_type: "Vorsorge",
    anamnesis: "50. Lebensjahr, Augencheck ohne Beschwerden, kontrollierte arterielle Hypertonie.",
    findings: "Visus beidseits 1,0 mit Korrektur; Papillen scharf, ZNÖ approx. 0,35–0,45.",
    diagnosis_text: "Alterspresbyopie, strukturierte Alterssichtprüfung.",
    therapy: "Lesebrillenrezept; nächstes Screening in 2 Jahren.",
    diagnosis_codes: [
      dx("H52.4", "Presbyopie", "high", "Alterskorrespondenz"),
      dx("Z01.0", "Untersuchung der Augen und des Sehvermögens", "medium", "Vorsorgekontext"),
    ],
    service_items_ebm: [ebm("21001"), ebm("21004")],
    service_items_goae: [mkGoae("3", 2.3), mkGoae("1240", 1.8), mkGoae("1242", 1.0)],
  },
  {
    difficulty: "medium",
    encounter_type: "Erstkontakt",
    anamnesis: "Unschärfe im zentralen Gesichtsfeld rechtlich seit Wochen, Metamorphopsien verneint.",
    findings: "Makula trocken, Drusen mittlerer Größe, OCT ohne Flüssigkeit.",
    diagnosis_text: "Altersbedingte Makuladegeneration (trockene AMD), beidseits.",
    therapy: "AREDS-Empfehlung besprechen, Verlauf OCT in 6 Monaten.",
    diagnosis_codes: [dx("H35.30", "Drusen der Makula (retinale)", "high", "OCT- und funduskopischer Befund")],
    service_items_ebm: [ebm("21002"), ebm("21005"), ebm("21004")],
    service_items_goae: [mkGoae("3", 2.5), mkGoae("1240", 2.3), mkGoae("1242", 1.8)],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Glaukomverdacht, Augendruck zuletzt grenzwertig, Familienanamnese positiv.",
    findings: "IOP 23/24 mmHg Goldmann, Papille ISNT asymmetrisch, RNFL-Ausdünnung inferior temporal.",
    diagnosis_text: "Okulärer Hypertonus / Verdacht auf Offenwinkelglaukom.",
    therapy: "Prostanalog beginnen, Verlauf 4 Wochen.",
    diagnosis_codes: [
      dx("H40.11", "Primäres Offenwinkelglaukom, Stadium unbestimmt", "medium", "Druck + Papillenbefund"),
    ],
    service_items_ebm: [ebm("21002"), ebm("21003"), ebm("21005")],
    service_items_goae: [mkGoae("5", 2.3), mkGoae("1240", 2.3), mkGoae("1241", 1.8), mkGoae("1242", 1.2)],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Diabetes mellitus Typ 2; jährliches diabetisches Augenscreening fällig.",
    findings: "Keine proliferative Retinopathie; wenige Mikroaneurysmen temporal inferi temporal.",
    diagnosis_text: "Leichte nicht proliferative diabetische Retinopathie.",
    therapy: "Strikte Einstellung, Wiederholung in 12 Monaten, Hinweis Augenarzt bei Sehstörungen.",
    diagnosis_codes: [
      dx("H36.0", "Retinopathie bei Diabetes mellitus", "high", "Screeningbefund"),
      dx("E11.9", "Typ-2-Diabetes mellitus ohne Komplikationen (Begleitdiagnose)", "medium", "bekannte Stoffwechsellage"),
    ],
    service_items_ebm: [ebm("21004"), ebm("21005"), ebm("21001")],
    service_items_goae: [mkGoae("1", 2.3), mkGoae("1240", 2.3), mkGoae("1242", 1.8)],
  },
  {
    difficulty: "medium",
    encounter_type: "Erstkontakt",
    anamnesis: "Beidseits verschwommenes Sehen seit zwei Wochen, neue Stärke vermutet.",
    findings: "Hornhaut klar, beginnend triebige Linse beidseits, Visus ohne Korrektur reduziert.",
    diagnosis_text: "Alterstar (Katarakt) beidseits — OP-Indikation Abklärung.",
    therapy: "Biometrie- und OP-Termin koordiniert.",
    diagnosis_codes: [dx("H25.9", "Alternder Linsentrübung, nicht näher bezeichnet", "high", "Biomikroskopie")],
    service_items_ebm: [ebm("21001"), ebm("21002"), ebm("21009")],
    service_items_goae: [mkGoae("3", 2.8), mkGoae("1240", 2.5), mkGoae("1242", 1.8), mkGoae("630", 1.5)],
  },
  {
    difficulty: "medium",
    encounter_type: "Notfall",
    anamnesis: "Plötzlich rot schmerzendes Auge, Übelkeit, Sehkraft links stark vermindert seit heute Morgen.",
    findings: "Mittelweit, Ödem Hornhaut, IOP 48 mmHg links, flache Vorderkammer DD Winkelblock.",
    diagnosis_text: "Akutes Winkelblockglaukom links.",
    therapy: "Notfalltherapie: pilocarpinähnlich, Azetazolamid, Laseriridotomie Anmeldung.",
    diagnosis_codes: [
      dx("H40.21", "Akutes Winkelblockglaukom, nicht näher bezeichnet", "high", "Klinik und IOP"),
      dx("H40.20", "Akutes Sekundärglaukom", "medium", "DD"),
    ],
    service_items_ebm: [ebm("21010"), ebm("21002"), ebm("21003")],
    service_items_goae: [mkGoae("620", 2.5), mkGoae("1", 3.2), mkGoae("1240", 2.8), mkGoae("03221", 2.0)],
  },
  {
    difficulty: "hard",
    encounter_type: "Folge",
    anamnesis: "Nach Katarakt-OP rechtlich leichte Unschärfe und Flimmern; OP vor 3 Wochen.",
    findings: "Hinterkapsel klar, kein Ödem Makula in OCT, IOL zentriert.",
    diagnosis_text: "Zustand nach Phakoemulsifikation re — Verlauf ohne Komplikation.",
    therapy: "NSAR-topisch auslaufen lassen, nächste Kontrolle 6 Wo.",
    diagnosis_codes: [
      dx("Z98.8", "Sonstiger spezifierter Zustand nach Augenoperation", "high", "postoperativ"),
      dx("H26.9", "Katarakt, nicht näher bezeichnet (Ausgangsbefund)", "low", "Anamnese"),
    ],
    service_items_ebm: [ebm("21002"), ebm("21005"), ebm("21008")],
    service_items_goae: [mkGoae("5", 2.5), mkGoae("1240", 2.3), mkGoae("1242", 1.8), mkGoae("640", 1.5)],
  },
  {
    difficulty: "medium",
    encounter_type: "Vorsorge",
    anamnesis: "Kinderuntersuchung, Eltern vermuten intermittierendes Schielen.",
    findings: "Alternierendes intermittierendes Exotropie bei Ermüdung, Stereo mind. 400″.",
    diagnosis_text: "Intermittierendes Schielen — Überwachung.",
    therapy: "Orthoptik-Termin, keine Operation indiziert zurzeit.",
    diagnosis_codes: [dx("H50.40", "Intermittierendes Exotropie, nicht näher bezeichnet", "medium", "Untersuchungsbefund")],
    service_items_ebm: [ebm("21001"), ebm("21002")],
    service_items_goae: [mkGoae("3", 2.3), mkGoae("1240", 2.0), mkGoae("1", 2.0)],
  },
  {
    difficulty: "hard",
    encounter_type: "Erstkontakt",
    anamnesis: "Lichtblitze und „Schleier“ temporal rechts seit 2 Tagen, Myopie hoch.",
    findings: "Weisslich hinterlegende Netzhautperipherie rechts, kein Makulaforamen — dringende Laserindikation geklärt.",
    diagnosis_text: "Netzhautabhebung rechts — Frühstadium.",
    therapy: "Notfall-Laserretinopexie / Vitrektomie-Anmeldung extern.",
    diagnosis_codes: [
      dx("H33.0", "Netzhautablösung mit Netzhautdefekt", "high", "Symptomtrio + Befund"),
      dx("H52.1", "Myopie", "medium", "Risikofaktor"),
    ],
    service_items_ebm: [ebm("21010"), ebm("21007"), ebm("21008"), ebm("21009")],
    service_items_goae: [mkGoae("620", 2.8), mkGoae("3", 3.2), mkGoae("1240", 2.8), mkGoae("1245", 1.8), mkGoae("630", 1.8)],
  },
  {
    difficulty: "medium",
    encounter_type: "Folge",
    anamnesis: "Grauer Star OP-Vorbereitung; Biometrie liegt vor.",
    findings: "Korneadurchmesser und Achslängen im Normbereich, keine Makulapathologie in OCT.",
    diagnosis_text: "Katarakt beidseits — elektive OP Planung.",
    therapy: "Linsenwahl besprochen, Prämedikationsplan.",
    diagnosis_codes: [dx("H25.1", "Kortikaler Alterstar", "high", "Vorbereitungsgrund")],
    service_items_ebm: [ebm("21001"), ebm("21005"), ebm("21009")],
    service_items_goae: [mkGoae("1", 2.5), mkGoae("1240", 2.5), mkGoae("1242", 1.5), mkGoae("3", 2.5)],
  },
  {
    difficulty: "hard",
    encounter_type: "Folge",
    anamnesis: "Zentrales Skotom links nach arteriellem Verschluss — Verlauf unter Therapie.",
    findings: "Pallor papillomakulärer Bündel, Gesichtsfeld zentral ausgefallen.",
    diagnosis_text: "Ischämische Optikusneuropathie links (DD AION).",
    therapy: "Internistische Risikofaktoren; neuroophthalmologische Mitbehandlung.",
    diagnosis_codes: [
      dx("H47.0", "Störungen des Sehnervs, nicht näher bezeichnet", "medium", "klinisches Bild"),
      dx("H34.9", "Gefäßverschluss der Netzhaut, nicht näher bezeichnet", "low", "DD"),
    ],
    service_items_ebm: [ebm("21006"), ebm("21005"), ebm("21007"), ebm("21004")],
    service_items_goae: [mkGoae("3", 3.2), mkGoae("1240", 2.8), mkGoae("1245", 2.3), mkGoae("1242", 2.0), mkGoae("630", 1.5)],
  },
  {
    difficulty: "easy",
    encounter_type: "Erstkontakt",
    anamnesis: "Rechts Schlagsahne-Veratzung Konjunktiva vor 24 h, starkes Brennen.",
    findings: "Chemische Konjunktivitis, pH neutralisiert, epitheliale Erosion lateral inferior.",
    diagnosis_text: "Verätzung der Konjunktiva und Kornea durch Chemikalie.",
    therapy: "Spülprotokoll, antibiotische Salbe, engmaschige Kontrolle.",
    diagnosis_codes: [
      dx("T26.1", "Verätzung der Kornea und des Konjunktivalsackes durch Seifen und Detergenzien", "high", "Anamnese"),
      dx("H16.2", "Keratitis filamentosa", "medium", "Erosionsbefund"),
    ],
    service_items_ebm: [ebm("21010"), ebm("21002")],
    service_items_goae: [mkGoae("620", 2.3), mkGoae("1240", 2.5), mkGoae("3020", 1.5)],
  },
];

const SANDBOX_MIN_INVOICE_EUR = 80;
const SANDBOX_MAX_INVOICE_EUR = 4900;

function targetInvoiceTotalForCaseIndex(i: number, n: number): number {
  if (n <= 1) return SANDBOX_MIN_INVOICE_EUR;
  return Math.round(SANDBOX_MIN_INVOICE_EUR + ((SANDBOX_MAX_INVOICE_EUR - SANDBOX_MIN_INVOICE_EUR) * i) / (n - 1));
}

function scaleBillingCaseToTotal(case_: SandboxBillingCase, targetTotal: number): SandboxBillingCase {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const cur = case_.total_amount;
  if (cur < 0.01) {
    return { ...case_, total_amount: r2(targetTotal) };
  }
  const f = targetTotal / cur;
  const service_items_goae = case_.service_items_goae.map((x) => ({ ...x, amount: r2(x.amount * f) }));
  const service_items_ebm = case_.service_items_ebm.map((x) => ({
    ...x,
    amount_eur: x.amount_eur != null ? r2(x.amount_eur * f) : x.amount_eur,
  }));
  let sum =
    service_items_goae.reduce((s, x) => s + x.amount, 0) +
    service_items_ebm.reduce((s, x) => s + (x.amount_eur ?? 0), 0);
  sum = r2(sum);
  const delta = r2(targetTotal - sum);
  if (Math.abs(delta) >= 0.005 && service_items_goae.length > 0) {
    const li = service_items_goae.length - 1;
    const last = service_items_goae[li]!;
    const nextGoae = [...service_items_goae.slice(0, li), { ...last, amount: r2(last.amount + delta) }];
    return { ...case_, service_items_goae: nextGoae, service_items_ebm, total_amount: r2(targetTotal) };
  }
  return { ...case_, service_items_goae, service_items_ebm, total_amount: r2(targetTotal) };
}

function sumAmount(case_: TemplateDef): number {
  const go = case_.service_items_goae.reduce((s, x) => s + x.amount, 0);
  const eb = case_.service_items_ebm.reduce((s, x) => s + (x.amount_eur ?? 0), 0);
  return Math.round((go + eb) * 100) / 100;
}

const BILLING_CASE_COUNT = 50;

/** Deterministisch 50 Cases aus Templates + Variationen (Spec). */
export function buildBillingCases(): SandboxBillingCase[] {
  const out: SandboxBillingCase[] = [];
  for (let i = 0; i < BILLING_CASE_COUNT; i++) {
    const t = TEMPLATES[i % TEMPLATES.length]!;
    const n = i + 1;
    const suffix = ` — Fall ${n}`;
    const doc: SandboxBillingCaseDocumentation = {
      encounter_type: t.encounter_type,
      anamnesis: t.anamnesis + suffix,
      findings: t.findings,
      diagnosis_text: t.diagnosis_text,
      therapy: t.therapy,
    };
    const diagnosis_codes = t.diagnosis_codes.map((row, j) =>
      j === 0 && i % 7 === 3 ? { ...row, rationale: `${row.rationale} (Variante ${n})` } : { ...row },
    );
    const service_items_goae = t.service_items_goae.map((row, j) => {
      if (j === 0 && i % 11 === 5) {
        const f = Math.min(3.5, row.factor + 0.2);
        const base = row.amount / row.factor;
        return { ...row, factor: f, amount: Math.round(base * f * 100) / 100 };
      }
      return { ...row };
    });
    const service_items_ebm = [...t.service_items_ebm];
    const total_amount = sumAmount({ ...t, diagnosis_codes, service_items_goae, service_items_ebm });
    let difficulty: SandboxBillingCase["difficulty"] = t.difficulty;
    if (i % 17 === 0 || i % 19 === 0) difficulty = "hard";
    else if (i % 5 === 0 || i % 7 === 0 || i % 3 === 0) difficulty = "medium";
    else if (t.difficulty === "easy") difficulty = "easy";

    const raw: SandboxBillingCase = {
      id: `sb-case-${String(n).padStart(3, "0")}`,
      difficulty,
      documentation: doc,
      highlights: t.highlights,
      diagnosis_codes,
      service_items_ebm,
      service_items_goae,
      total_amount,
      meta: { notes: `Fall sb-case-${String(n).padStart(3, "0")} · Vorlage ${(i % TEMPLATES.length) + 1}` },
    };
    const target = targetInvoiceTotalForCaseIndex(i, BILLING_CASE_COUNT);
    out.push(scaleBillingCaseToTotal(raw, target));
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
): SandboxInvoice {
  const timeline: TimelineEntry[] = [
    { ts: new Date().toISOString(), event: "Abrechnungsvorschlag geladen", actor: "System" },
  ];
  const base: SandboxInvoice = {
    id: invoiceId,
    documentation_id: docId,
    patient_id: patientId,
    diagnosis_codes: c.diagnosis_codes.map((d) => ({ ...d })),
    service_items_ebm: c.service_items_ebm.map((x) => ({ ...x })),
    service_items_goae: c.service_items_goae.map((x) => ({ ...x })),
    total_amount: c.total_amount,
    status: initialStatus,
    timeline,
    confidence_tier: "high",
    confidence_percent: 90,
    card_code_summary: "",
  };
  return { ...base, ...invoicePresentationPatch(base) };
}
