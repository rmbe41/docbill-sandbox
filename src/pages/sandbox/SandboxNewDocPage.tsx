import { Link, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import {
  SANDBOX_CONSENT_LABEL,
  type EncounterType,
  type InsuranceType,
  type SandboxDocumentation,
  type SandboxInvoice,
  type SandboxPatient,
  type SandboxProvider,
} from "@/lib/sandbox/types";
import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import { randomReserveScenarioIndex, SANDBOX_SCENARIO_ROWS } from "@/lib/sandbox/sandboxScenarioCatalog";
import { cn } from "@/lib/utils";
import { FileText, Upload, Wand2 } from "lucide-react";
import {
  getSandboxSampleDocumentationFormFill,
  SANDBOX_SAMPLE_UPLOAD_FILE,
} from "@/data/sandbox/sampleDocumentationUpload";
import { GKV_NAMES, PKV_NAMES } from "@/data/sandbox/krankenkassenCatalog";
import { InsurerLabelRow, InsurerMark } from "@/components/sandbox/InsurerMark";
import {
  SandboxStreetAutocomplete,
  type SandboxStreetPlaceDetails,
} from "@/components/sandbox/SandboxStreetAutocomplete";
import { PayerChip } from "@/components/sandbox/sandboxUi";
import { SandboxEuropeanDateInput } from "@/components/sandbox/SandboxEuropeanDateInput";
import { formatSandboxDateEuropean } from "@/lib/sandbox/europeanDate";

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  proposed: "Vorschlag",
  invoiced: "Abgerechnet",
};

function normName(s: string) {
  return s.trim().toLowerCase();
}

const SANDBOX_INSURANCE_STATUSES = ["Mitglied", "Familienversichert", "Versichert", "Selbstzahlend"] as const;
type SandboxInsuranceStatusLabel = (typeof SANDBOX_INSURANCE_STATUSES)[number];

function coerceInsuranceStatus(v: string): SandboxInsuranceStatusLabel {
  const t = v.trim();
  return (SANDBOX_INSURANCE_STATUSES as readonly string[]).includes(t)
    ? (t as SandboxInsuranceStatusLabel)
    : "Mitglied";
}

const SANDBOX_GENDERS = ["weiblich", "männlich", "divers"] as const;

/** xxx@xxx.xxx: lokaler Teil, @, Domain mit mindestens einem Punkt und TLD ≥ 2 Zeichen */
function isValidSandboxEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[^\d+\s\-()./]/g, "");
}

type SandboxStammdatenFormSharedProps = {
  errors: Record<string, string>;
  dob: string;
  setDob: (v: string) => void;
  insNum: string;
  setInsNum: (v: string) => void;
  insType: InsuranceType;
  setInsType: (v: InsuranceType) => void;
  insProvider: string;
  setInsProvider: (v: string) => void;
  insStatus: string;
  setInsStatus: (v: string) => void;
  insuranceMemberSince: string;
  setInsuranceMemberSince: (v: string) => void;
  insuranceIk: string;
  setInsuranceIk: (v: string) => void;
  gender: string;
  setGender: (v: string) => void;
  street: string;
  setStreet: (v: string) => void;
  postalCode: string;
  setPostalCode: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  handleStreetPlaceResolved: (details: SandboxStreetPlaceDetails) => void;
};

function SandboxPatientStammdatenFormGrid({
  variant,
  ...f
}: { variant: "new" | "edit" } & SandboxStammdatenFormSharedProps) {
  const {
    errors,
    dob,
    setDob,
    insNum,
    setInsNum,
    insType,
    setInsType,
    insProvider,
    setInsProvider,
    insStatus,
    setInsStatus,
    insuranceMemberSince,
    setInsuranceMemberSince,
    insuranceIk,
    setInsuranceIk,
    gender,
    setGender,
    street,
    setStreet,
    postalCode,
    setPostalCode,
    city,
    setCity,
    phone,
    setPhone,
    email,
    setEmail,
    handleStreetPlaceResolved,
  } = f;

  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2",
        variant === "new" && "rounded-lg border border-border/80 bg-muted/10 p-4",
      )}
    >
      {variant === "new" && (
        <div className="space-y-2 sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            Zu diesem Namen liegt kein Eintrag vor — Stammdaten vervollständigen.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="dob">Geburtsdatum</Label>
        <SandboxEuropeanDateInput
          id="dob"
          value={dob}
          onValueChange={setDob}
          className={errors.dob ? "border-destructive" : ""}
        />
        {errors.dob && <p className="text-xs text-destructive">{errors.dob}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="vin">Versichertennummer</Label>
        <Input id="vin" value={insNum} onChange={(e) => setInsNum(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Kostenträger-Typ</Label>
        <Select value={insType} onValueChange={(v) => setInsType(v as InsuranceType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GKV">GKV</SelectItem>
            <SelectItem value="PKV">PKV</SelectItem>
            <SelectItem value="self">Selbstzahler</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {insType === "GKV" && (
        <div className="space-y-2 sm:col-span-2">
          <Label>Krankenkasse (GKV)</Label>
          <Select value={insProvider} onValueChange={setInsProvider}>
            <SelectTrigger>
              <span className="flex min-w-0 items-center gap-2">
                <SelectValue placeholder="Kasse wählen" />
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-[min(50vh,360px)]">
              {GKV_NAMES.map((k) => (
                <SelectItem key={k} value={k} textValue={k}>
                  <span className="flex items-center gap-2">
                    <InsurerMark name={k} size="md" />
                    <span>{k}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {insType === "PKV" && (
        <div className="space-y-2 sm:col-span-2">
          <Label>Private Krankenversicherung</Label>
          <Select value={insProvider} onValueChange={setInsProvider}>
            <SelectTrigger>
              <span className="flex min-w-0 items-center gap-2">
                <SelectValue placeholder="Versicherer wählen" />
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-[min(50vh,360px)]">
              {PKV_NAMES.map((k) => (
                <SelectItem key={k} value={k} textValue={k}>
                  <span className="flex items-center gap-2">
                    <InsurerMark name={k} size="md" />
                    <span>{k}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2 sm:col-span-2">
        <Label>Versicherungsstatus</Label>
        <Select
          value={coerceInsuranceStatus(insStatus)}
          onValueChange={(v) => setInsStatus(v)}
          disabled={insType === "self"}
        >
          <SelectTrigger id="st">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SANDBOX_INSURANCE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="memsince">Mitglied / Versichert seit</Label>
        <SandboxEuropeanDateInput id="memsince" value={insuranceMemberSince} onValueChange={setInsuranceMemberSince} />
      </div>
      {insType === "GKV" && (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="ik">IK Krankenkasse (optional)</Label>
          <Input
            id="ik"
            inputMode="numeric"
            placeholder="9-stelliges Institutionskennzeichen"
            value={insuranceIk}
            onChange={(e) => setInsuranceIk(e.target.value)}
          />
        </div>
      )}
      <div className="space-y-2 sm:col-span-2 border-t border-border/60 pt-3 mt-1">
        <p className="text-xs font-medium text-foreground">Kontakt und Adresse</p>
      </div>
      <div className="space-y-2">
        <Label>Geschlecht</Label>
        <Select
          value={gender && (SANDBOX_GENDERS as readonly string[]).includes(gender) ? gender : "__none__"}
          onValueChange={(v) => setGender(v === "__none__" ? "" : v)}
        >
          <SelectTrigger id="gender">
            <SelectValue placeholder="Auswahl" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Keine Angabe</SelectItem>
            {SANDBOX_GENDERS.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="street">Straße und Hausnummer</Label>
        <SandboxStreetAutocomplete
          id="street"
          value={street}
          onChange={setStreet}
          onPlaceResolved={handleStreetPlaceResolved}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="plz">PLZ</Label>
        <Input id="plz" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">Ort</Label>
        <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
          placeholder="+49 …"
          className={errors.phone ? "border-destructive" : undefined}
        />
        {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">E-Mail</Label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={errors.email ? "border-destructive" : undefined}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
      </div>
    </div>
  );
}

export default function SandboxNewDocPage() {
  const navigate = useNavigate();
  const { state, upsertPatient, upsertProvider, addDocumentation } = useSandbox();

  /** Nach „Testdaten generieren“: nächste gespeicherte Doku erhält diese `case_id` (Abrechnung = Kurator-Fall). */
  const billingCaseIdFromGeneratorRef = useRef<string | null>(null);

  const [patientNameInput, setPatientNameInput] = useState("");
  const [patientSuggestOpen, setPatientSuggestOpen] = useState(false);
  const [dob, setDob] = useState("");
  const [insNum, setInsNum] = useState("");
  const [insType, setInsType] = useState<InsuranceType>("GKV");
  const [insProvider, setInsProvider] = useState<string>(GKV_NAMES[0] ?? "");
  const [insStatus, setInsStatus] = useState("Mitglied");
  const [gender, setGender] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [insuranceMemberSince, setInsuranceMemberSince] = useState("");
  const [insuranceIk, setInsuranceIk] = useState("");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [providerNameInput, setProviderNameInput] = useState(() => state.providers[0]?.name ?? "");
  const [providerSuggestOpen, setProviderSuggestOpen] = useState(false);
  const [encounter, setEncounter] = useState<EncounterType>("Erstkontakt");
  const [anamnesis, setAnamnesis] = useState("");
  const [findings, setFindings] = useState("");
  const [diagnosisText, setDiagnosisText] = useState("");
  const [therapy, setTherapy] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false);
  const [stammdatenEditing, setStammdatenEditing] = useState(false);

  const sortedPatients = useMemo(() => [...state.patients].sort((a, b) => a.name.localeCompare(b.name)), [state.patients]);
  const sortedProviders = useMemo(
    () => [...state.providers].sort((a, b) => a.name.localeCompare(b.name)),
    [state.providers],
  );

  const patientNameTrim = patientNameInput.trim();
  const patientSuggestions = useMemo(() => {
    if (!patientNameTrim) return [];
    const q = normName(patientNameInput);
    return sortedPatients.filter((p) => normName(p.name).includes(q)).slice(0, 8);
  }, [patientNameInput, patientNameTrim, sortedPatients]);

  const matchedPatientByExactName = useMemo(() => {
    if (!patientNameTrim) return undefined;
    return sortedPatients.find((p) => normName(p.name) === normName(patientNameInput));
  }, [patientNameInput, patientNameTrim, sortedPatients]);

  const isNewPatientFields = Boolean(patientNameTrim && !matchedPatientByExactName);

  const patientHistory = useMemo(() => {
    if (!matchedPatientByExactName) return [];
    return state.documentations
      .filter((d) => d.patient_id === matchedPatientByExactName.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [matchedPatientByExactName, state.documentations]);

  const providerSuggestions = useMemo(() => {
    const q = normName(providerNameInput);
    if (!q) return sortedProviders.slice(0, 8);
    return sortedProviders.filter((p) => normName(p.name).includes(q)).slice(0, 8);
  }, [providerNameInput, sortedProviders]);

  useEffect(() => {
    if (insType === "GKV") setInsProvider((p) => (GKV_NAMES.includes(p) ? p : (GKV_NAMES[0] ?? "")));
    if (insType === "PKV") setInsProvider((p) => (PKV_NAMES.includes(p) ? p : (PKV_NAMES[0] ?? "")));
  }, [insType]);

  useEffect(() => {
    if (insType === "self") {
      setInsStatus("Selbstzahlend");
      return;
    }
    setInsStatus((prev) => {
      if (prev === "Selbstzahlend") return insType === "PKV" ? "Versichert" : "Mitglied";
      return prev;
    });
  }, [insType]);

  const handleStreetPlaceResolved = useCallback((details: SandboxStreetPlaceDetails) => {
    setStreet(details.street);
    if (details.postalCode) setPostalCode(details.postalCode);
    if (details.city) setCity(details.city);
  }, []);

  const hydratePatientFormFromSandboxPatient = useCallback((p: SandboxPatient) => {
    setDob(p.dob);
    setInsNum(p.insurance_number === "—" ? "" : p.insurance_number);
    setInsType(p.insurance_type);
    setInsProvider(p.insurance_provider);
    setInsStatus(
      coerceInsuranceStatus(
        p.insurance_status?.trim() && p.insurance_status !== "—"
          ? p.insurance_status
          : p.insurance_type === "GKV"
            ? "Mitglied"
            : p.insurance_type === "PKV"
              ? "Versichert"
              : "Selbstzahlend",
      ),
    );
    const g = (p.gender ?? "").trim();
    setGender((SANDBOX_GENDERS as readonly string[]).includes(g) ? g : "");
    setStreet(p.street ?? "");
    setPostalCode(p.postal_code ?? "");
    setCity(p.city ?? "");
    setPhone(p.phone ?? "");
    setEmail(p.email ?? "");
    setInsuranceMemberSince(p.insurance_member_since ?? "");
    setInsuranceIk(p.insurance_ik ?? "");
  }, []);

  // Nur bei anderem Patient (ID) neu befüllen; gleicher Patient nach Upsert soll Bearbeiten-Modus nicht schließen.
  useEffect(() => {
    const p = matchedPatientByExactName;
    if (!p) return;
    hydratePatientFormFromSandboxPatient(p);
    setStammdatenEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur `id`, siehe oben
  }, [matchedPatientByExactName?.id, hydratePatientFormFromSandboxPatient]);

  const stampPatientContactErrors = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};
    const em = email.trim();
    if (em && !isValidSandboxEmail(em)) {
      e.email = "E-Mail im Format name@domain.xx (mit Punkt in der Domain)";
    }
    const ph = phone.trim();
    if (ph && /[^\d+\s\-()./]/.test(ph)) {
      e.phone = "Telefon nur Ziffern, Ländervorwahl (+…) und gängige Trennzeichen";
    }
    return e;
  }, [email, phone]);

  const buildMergedPatientFromForm = useCallback(
    (base: SandboxPatient): SandboxPatient => ({
      ...base,
      name: patientNameTrim,
      dob: dob.trim(),
      insurance_number: insNum.trim() || "—",
      insurance_type: insType,
      insurance_provider: insType === "GKV" || insType === "PKV" ? insProvider : "Selbstzahler",
      insurance_status: coerceInsuranceStatus(insStatus),
      gender: gender.trim() || undefined,
      street: street.trim() || undefined,
      postal_code: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      insurance_member_since: insuranceMemberSince.trim() || undefined,
      insurance_ik: insType === "GKV" && insuranceIk.trim() ? insuranceIk.trim() : undefined,
    }),
    [
      patientNameTrim,
      dob,
      insNum,
      insType,
      insProvider,
      insStatus,
      gender,
      street,
      postalCode,
      city,
      phone,
      email,
      insuranceMemberSince,
      insuranceIk,
    ],
  );

  const saveMatchedPatientStammdaten = useCallback(() => {
    if (!matchedPatientByExactName) return;
    const se = stampPatientContactErrors();
    if (Object.keys(se).length > 0) {
      setErrors((prev) => ({ ...prev, ...se }));
      return;
    }
    upsertPatient(buildMergedPatientFromForm(matchedPatientByExactName));
    setStammdatenEditing(false);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.email;
      delete next.phone;
      return next;
    });
  }, [
    matchedPatientByExactName,
    stampPatientContactErrors,
    buildMergedPatientFromForm,
    upsertPatient,
  ]);

  const cancelMatchedPatientStammdatenEdit = useCallback(() => {
    const id = matchedPatientByExactName?.id;
    const fresh = id ? state.patients.find((p) => p.id === id) : undefined;
    if (fresh) hydratePatientFormFromSandboxPatient(fresh);
    else if (matchedPatientByExactName) hydratePatientFormFromSandboxPatient(matchedPatientByExactName);
    setStammdatenEditing(false);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.email;
      delete next.phone;
      return next;
    });
  }, [matchedPatientByExactName, state.patients, hydratePatientFormFromSandboxPatient]);

  const fillTestData = useCallback(() => {
    const si = randomReserveScenarioIndex();
    const row = SANDBOX_SCENARIO_ROWS[si]!;
    const c = BILLING_CASES[row.billing_case_index % BILLING_CASES.length]!;
    const p = state.patients[row.patient_index % state.patients.length]!;
    billingCaseIdFromGeneratorRef.current = c.id;
    setPatientNameInput(p.name);
    hydratePatientFormFromSandboxPatient(p);
    setDate(new Date().toISOString().slice(0, 10));
    setProviderNameInput(state.providers[0]?.name ?? "");
    setEncounter(c.documentation.encounter_type);
    setAnamnesis(c.documentation.anamnesis);
    setFindings(c.documentation.findings);
    setDiagnosisText(c.documentation.diagnosis_text);
    setTherapy(c.documentation.therapy);
    setErrors({});
    setStammdatenEditing(false);
  }, [state.patients, state.providers, hydratePatientFormFromSandboxPatient]);

  const applySampleDocumentationUpload = useCallback(() => {
    const fill = getSandboxSampleDocumentationFormFill({
      patientDisplayName: state.patients[0]?.name ?? "",
      providerName: state.providers[0]?.name ?? "",
    });
    setPatientNameInput(fill.patientNameInput);
    setDate(fill.date);
    setProviderNameInput(fill.providerNameInput);
    setEncounter(fill.encounter);
    setAnamnesis(fill.anamnesis);
    setFindings(fill.findings);
    setDiagnosisText(fill.diagnosisText);
    setTherapy(fill.therapy);
    setErrors({});
    setUploadPopoverOpen(false);
  }, [state.patients, state.providers]);

  const ensurePatientId = (): string | null => {
    if (!patientNameTrim) return null;
    if (matchedPatientByExactName) {
      upsertPatient(buildMergedPatientFromForm(matchedPatientByExactName));
      return matchedPatientByExactName.id;
    }
    if (!dob.trim()) return null;
    const id = `sb-pat-${Date.now()}`;
    upsertPatient({
      id,
      name: patientNameTrim,
      dob: dob.trim(),
      insurance_number: insNum.trim() || "—",
      insurance_type: insType,
      insurance_provider: insType === "GKV" || insType === "PKV" ? insProvider : "Selbstzahler",
      insurance_status: coerceInsuranceStatus(insStatus),
      gender: gender.trim() || undefined,
      street: street.trim() || undefined,
      postal_code: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      insurance_member_since: insuranceMemberSince.trim() || undefined,
      insurance_ik: insType === "GKV" && insuranceIk.trim() ? insuranceIk.trim() : undefined,
    });
    return id;
  };

  const ensureProviderId = (): string | null => {
    const t = providerNameInput.trim();
    if (!t) return null;
    const hit = state.providers.find((p) => normName(p.name) === normName(t));
    if (hit) return hit.id;
    const id = `sb-prov-${Date.now()}`;
    upsertProvider({ id, name: t });
    return id;
  };

  const validateFields = (): boolean => {
    const e: Record<string, string> = {};
    if (!patientNameTrim) e.patient = "Patientenname erforderlich";
    if (isNewPatientFields) {
      if (!dob.trim()) e.dob = "Geburtsdatum erforderlich";
    }
    if (isNewPatientFields || matchedPatientByExactName) {
      Object.assign(e, stampPatientContactErrors());
    }
    if (!date) e.date = "Datum erforderlich";
    if (!providerNameInput.trim()) e.provider = "Behandlungsperson erforderlich";
    if (!anamnesis.trim() && !findings.trim()) e.text = "Mindestens Anamnese oder Befund ausfüllen";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildDocPayload = (patientId: string, provId: string) => {
    const idx =
      Math.abs((patientId + date + diagnosisText).split("").reduce((a, ch) => ((a << 5) - a + ch.charCodeAt(0)) | 0, 0)) %
      BILLING_CASES.length;
    const caseFromHash = BILLING_CASES[idx]!.id;
    const curatedCaseId = billingCaseIdFromGeneratorRef.current;
    billingCaseIdFromGeneratorRef.current = null;
    const case_id = curatedCaseId ?? caseFromHash;
    return {
      id: `sb-doc-${Date.now()}`,
      patient_id: patientId,
      date,
      provider_id: provId,
      encounter_type: encounter,
      anamnesis: anamnesis.trim(),
      findings: findings.trim(),
      diagnosis_text: diagnosisText.trim(),
      therapy: therapy.trim(),
      case_id,
      created_at: new Date().toISOString(),
    };
  };

  const stammdatenFormProps: SandboxStammdatenFormSharedProps = {
    errors,
    dob,
    setDob,
    insNum,
    setInsNum,
    insType,
    setInsType,
    insProvider,
    setInsProvider,
    insStatus,
    setInsStatus,
    insuranceMemberSince,
    setInsuranceMemberSince,
    insuranceIk,
    setInsuranceIk,
    gender,
    setGender,
    street,
    setStreet,
    postalCode,
    setPostalCode,
    city,
    setCity,
    phone,
    setPhone,
    email,
    setEmail,
    handleStreetPlaceResolved,
  };

  const saveDraft = () => {
    if (!validateFields()) return;
    const pid = ensurePatientId();
    const prid = ensureProviderId();
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patientendaten unvollständig" }));
      return;
    }
    if (!prid) {
      setErrors((prev) => ({ ...prev, provider: "Behandlungsperson unvollständig" }));
      return;
    }
    addDocumentation({ ...buildDocPayload(pid, prid), status: "draft" });
    navigate("/dokumentationen");
  };

  const saveAndPropose = () => {
    if (!validateFields()) return;
    const pid = ensurePatientId();
    const prid = ensureProviderId();
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patientendaten unvollständig" }));
      return;
    }
    if (!prid) {
      setErrors((prev) => ({ ...prev, provider: "Behandlungsperson unvollständig" }));
      return;
    }
    const doc = { ...buildDocPayload(pid, prid), status: "draft" as const };
    addDocumentation(doc);
    navigate(`/analyse/${doc.id}`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Neue Dokumentation</h1>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Popover open={uploadPopoverOpen} onOpenChange={setUploadPopoverOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <Upload className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                Datei hochladen
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(calc(100vw-2rem),22rem)] p-0 shadow-lg">
              <div className="border-b border-border/70 px-4 py-3">
                <p className="text-sm font-medium">Dokumentation übernehmen</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  Nur die vorbereitete Beispieldatei ist verfügbar. Eigene Dateien können in dieser Sandbox nicht
                  hochgeladen werden.
                </p>
              </div>
              <div className="p-4">
                <div className="rounded-lg border-2 border-dashed border-border/80 bg-muted/20 px-3 py-4">
                  <p className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-3">
                    Bereitgestellte Datei
                  </p>
                  <button
                    type="button"
                    onClick={applySampleDocumentationUpload}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileText className="h-9 w-9 shrink-0 text-primary/70" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium block truncate">{SANDBOX_SAMPLE_UPLOAD_FILE.fileName}</span>
                      <span className="text-xs text-muted-foreground">
                        {SANDBOX_SAMPLE_UPLOAD_FILE.sizeLabel} · Inhalt aus Demo-Vorlage
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button type="button" variant="secondary" size="sm" onClick={fillTestData} className="gap-2">
            <Wand2 className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            Testdaten generieren
          </Button>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground">Patient</h2>
        <div className="space-y-2 relative">
          <Label htmlFor="patient-name">Name</Label>
          <Input
            id="patient-name"
            autoComplete="off"
            value={patientNameInput}
            onChange={(e) => {
              setPatientNameInput(e.target.value);
              setPatientSuggestOpen(true);
            }}
            onFocus={() => setPatientSuggestOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setPatientSuggestOpen(false), 120);
            }}
            className={cn(errors.patient && "border-destructive")}
            placeholder="Name eingeben oder aus Vorschlägen wählen…"
          />
          {patientSuggestOpen && patientSuggestions.length > 0 && (
            <ul
              className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md max-h-56 overflow-auto py-1"
              role="listbox"
            >
              {patientSuggestions.map((p) => (
                <li key={p.id} role="option">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPatientNameInput(p.name);
                      setPatientSuggestOpen(false);
                    }}
                  >
                    <InsurerMark name={p.insurance_provider} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{p.insurance_provider}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.patient && <p className="text-xs text-destructive">{errors.patient}</p>}
        </div>

        {matchedPatientByExactName && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/80 bg-muted/15 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/55 px-4 py-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stammdaten</p>
                {!stammdatenEditing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => setStammdatenEditing(true)}
                  >
                    Bearbeiten
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={cancelMatchedPatientStammdatenEdit}>
                      Abbrechen
                    </Button>
                    <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={saveMatchedPatientStammdaten}>
                      Speichern
                    </Button>
                  </div>
                )}
              </div>
              <div className="p-4">
                {stammdatenEditing ? (
                  <SandboxPatientStammdatenFormGrid variant="edit" {...stammdatenFormProps} />
                ) : (
                  <PatientStammdatenCard patient={matchedPatientByExactName} embedded />
                )}
              </div>
            </div>
            <PatientHistorieBlock
              docs={patientHistory}
              invoices={state.invoices}
              providers={state.providers}
            />
          </div>
        )}

        {isNewPatientFields && <SandboxPatientStammdatenFormGrid variant="new" {...stammdatenFormProps} />}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground">Behandlung</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dt">Datum</Label>
            <SandboxEuropeanDateInput
              id="dt"
              value={date}
              onValueChange={setDate}
              className={errors.date ? "border-destructive" : ""}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
          </div>
          <div className="space-y-2 relative">
            <Label htmlFor="prov-name">Behandlungsperson</Label>
            <Input
              id="prov-name"
              autoComplete="off"
              value={providerNameInput}
              onChange={(e) => {
                setProviderNameInput(e.target.value);
                setProviderSuggestOpen(true);
              }}
              onFocus={() => setProviderSuggestOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setProviderSuggestOpen(false), 120);
              }}
              className={cn(errors.provider && "border-destructive")}
              placeholder="Name — Vorschläge beim Tippen oder frei eingeben"
            />
            {providerSuggestOpen && providerSuggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1">
                {providerSuggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setProviderNameInput(p.name);
                        setProviderSuggestOpen(false);
                      }}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errors.provider && <p className="text-xs text-destructive">{errors.provider}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Behandlungsart</Label>
            <Select value={encounter} onValueChange={(v) => setEncounter(v as EncounterType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Erstkontakt">Erstkontakt</SelectItem>
                <SelectItem value="Folge">Folge</SelectItem>
                <SelectItem value="Notfall">Notfall</SelectItem>
                <SelectItem value="Vorsorge">Vorsorge</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Anamnese</Label>
          <Textarea rows={4} value={anamnesis} onChange={(e) => setAnamnesis(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Befund</Label>
          <Textarea rows={4} value={findings} onChange={(e) => setFindings(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Diagnose</Label>
          <Textarea rows={2} value={diagnosisText} onChange={(e) => setDiagnosisText(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Therapie / Leistungen</Label>
          <Textarea rows={3} value={therapy} onChange={(e) => setTherapy(e.target.value)} />
        </div>
        {errors.text && <p className="text-xs text-destructive">{errors.text}</p>}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-6">
        <Button type="button" variant="outline" onClick={saveDraft}>
          Entwurf speichern
        </Button>
        <Button type="button" onClick={saveAndPropose}>
          Rechnung erstellen
        </Button>
      </div>
    </div>
  );
}

function StammdatenRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,118px)_1fr] gap-x-3 gap-y-0.5 py-1.5 text-sm border-b border-border/45 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value != null && value !== "" ? value : "—"}</span>
    </div>
  );
}

function PatientStammdatenCard({ patient, embedded }: { patient: SandboxPatient; embedded?: boolean }) {
  return (
    <div className="space-y-4">
      <div>
        {!embedded && (
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stammdaten</p>
        )}
        <div className={cn(!embedded ? "mt-2" : undefined)}>
          <StammdatenRow label="Geburtsdatum" value={formatSandboxDateEuropean(patient.dob)} />
          <StammdatenRow label="Geschlecht" value={patient.gender} />
          <StammdatenRow
            label="Adresse"
            value={
              [patient.street, [patient.postal_code, patient.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") ||
              undefined
            }
          />
          <StammdatenRow label="Telefon" value={patient.phone} />
          <StammdatenRow label="Telefon alternativ" value={patient.phone_alt} />
          <StammdatenRow label="E-Mail" value={patient.email} />
          <StammdatenRow
            label="Datenschutz"
            value={patient.consent_status ? SANDBOX_CONSENT_LABEL[patient.consent_status] : undefined}
          />
        </div>
      </div>
      <div className="border-t border-border/60 pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Versicherung</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PayerChip type={patient.insurance_type} />
          <InsurerLabelRow name={patient.insurance_provider} textClassName="text-xs text-muted-foreground" />
        </div>
        <div className="mt-2">
          <StammdatenRow label="Versicherten-Nr." value={patient.insurance_number} />
          <StammdatenRow label="Status" value={patient.insurance_status} />
          <StammdatenRow label="Mitglied seit" value={formatSandboxDateEuropean(patient.insurance_member_since)} />
          {patient.insurance_type === "GKV" && (
            <StammdatenRow label="IK Kasse" value={patient.insurance_ik} />
          )}
        </div>
      </div>
    </div>
  );
}

function PatientHistorieBlock({
  docs,
  invoices,
  providers,
}: {
  docs: SandboxDocumentation[];
  invoices: SandboxInvoice[];
  providers: SandboxProvider[];
}) {
  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        Noch keine früheren Dokumentationen zu dieser Person in der Sandbox.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80 bg-background p-4">
      <h3 className="text-sm font-medium text-foreground">Historie</h3>
      <p className="text-xs text-muted-foreground mt-0.5">Frühere Dokumentationen (neueste zuerst)</p>
      <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1">
        {docs.map((doc) => {
          const inv = invoices.find((i) => i.documentation_id === doc.id);
          const providerName = providers.find((p) => p.id === doc.provider_id)?.name ?? doc.provider_id;
          const href = inv ? `/review/${inv.id}` : `/analyse/${doc.id}`;
          const label = DOC_STATUS_LABEL[doc.status] ?? doc.status;
          return (
            <li key={doc.id}>
              <Link
                to={href}
                className="block rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-sm transition-colors hover:bg-muted/25"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular-nums text-muted-foreground">{formatSandboxDateEuropean(doc.date)}</span>
                  <Badge variant="secondary" className="font-normal text-xs">
                    {label}
                  </Badge>
                </div>
                <p className="mt-1 font-medium text-foreground">{doc.encounter_type}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{doc.diagnosis_text || "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">{providerName}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
