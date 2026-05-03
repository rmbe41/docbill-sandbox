import { Link, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import type { EncounterType, InsuranceType, SandboxDocumentation, SandboxInvoice, SandboxPatient, SandboxProvider } from "@/lib/sandbox/types";
import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import { cn } from "@/lib/utils";
import { Wand2 } from "lucide-react";
import { GKV_NAMES, PKV_NAMES } from "@/data/sandbox/krankenkassenCatalog";
import { InsurerLabelRow, InsurerMark } from "@/components/sandbox/InsurerMark";
import { PayerChip } from "@/components/sandbox/sandboxUi";

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  proposed: "Vorschlag",
  invoiced: "Abgerechnet",
};

function normName(s: string) {
  return s.trim().toLowerCase();
}

export default function SandboxNewDocPage() {
  const navigate = useNavigate();
  const { state, upsertPatient, upsertProvider, addDocumentation } = useSandbox();

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

  const fillTestData = useCallback(() => {
    const c = BILLING_CASES[Math.floor(Math.random() * BILLING_CASES.length)]!;
    const p = state.patients[Math.floor(Math.random() * state.patients.length)]!;
    setPatientNameInput(p.name);
    setDate(new Date().toISOString().slice(0, 10));
    setProviderNameInput(state.providers[0]?.name ?? "");
    setEncounter(c.documentation.encounter_type);
    setAnamnesis(c.documentation.anamnesis);
    setFindings(c.documentation.findings);
    setDiagnosisText(c.documentation.diagnosis_text);
    setTherapy(c.documentation.therapy);
    setErrors({});
  }, [state.patients, state.providers]);

  const ensurePatientId = (): string | null => {
    if (!patientNameTrim) return null;
    if (matchedPatientByExactName) return matchedPatientByExactName.id;
    if (!dob.trim()) return null;
    const id = `sb-pat-${Date.now()}`;
    upsertPatient({
      id,
      name: patientNameTrim,
      dob: dob.trim(),
      insurance_number: insNum.trim() || "—",
      insurance_type: insType,
      insurance_provider: insType === "GKV" || insType === "PKV" ? insProvider : "Selbstzahler",
      insurance_status: insStatus,
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
    if (!patientNameTrim) e.patient = "Name der Patient:in erforderlich";
    if (isNewPatientFields) {
      if (!dob.trim()) e.dob = "Geburtsdatum erforderlich";
    }
    if (!date) e.date = "Datum erforderlich";
    if (!providerNameInput.trim()) e.provider = "Behandelnde:r erforderlich";
    if (!anamnesis.trim() && !findings.trim()) e.text = "Mindestens Anamnese oder Befund ausfüllen";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildDocPayload = (patientId: string, provId: string) => {
    const idx =
      Math.abs((patientId + date + diagnosisText).split("").reduce((a, ch) => ((a << 5) - a + ch.charCodeAt(0)) | 0, 0)) %
      BILLING_CASES.length;
    const caseFromHash = BILLING_CASES[idx]!.id;
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
      case_id: caseFromHash,
      created_at: new Date().toISOString(),
    };
  };

  const saveDraft = () => {
    if (!validateFields()) return;
    const pid = ensurePatientId();
    const prid = ensureProviderId();
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patient:in unvollständig" }));
      return;
    }
    if (!prid) {
      setErrors((prev) => ({ ...prev, provider: "Behandelnde:r unvollständig" }));
      return;
    }
    addDocumentation({ ...buildDocPayload(pid, prid), status: "draft" });
    navigate("/sandbox/dokumentationen");
  };

  const saveAndPropose = () => {
    if (!validateFields()) return;
    const pid = ensurePatientId();
    const prid = ensureProviderId();
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patient:in unvollständig" }));
      return;
    }
    if (!prid) {
      setErrors((prev) => ({ ...prev, provider: "Behandelnde:r unvollständig" }));
      return;
    }
    const doc = { ...buildDocPayload(pid, prid), status: "draft" as const };
    addDocumentation(doc);
    navigate(`/sandbox/analyse/${doc.id}`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Neue Dokumentation</h1>
        <Button type="button" variant="secondary" size="sm" onClick={fillTestData} className="gap-2 shrink-0">
          <Wand2 className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          Testdaten generieren
        </Button>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground">Patient:in</h2>
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
            <PatientStammdatenCard patient={matchedPatientByExactName} />
            <PatientHistorieBlock
              docs={patientHistory}
              invoices={state.invoices}
              providers={state.providers}
            />
          </div>
        )}

        {isNewPatientFields && (
          <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border/80 bg-muted/10 p-4">
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs text-muted-foreground">Kein:e Patient:in mit diesem Namen — Stammdaten vervollständigen.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dob">Geburtsdatum</Label>
              <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={errors.dob ? "border-destructive" : ""} />
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
                      <InsurerMark name={insProvider} size="md" />
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
                      <InsurerMark name={insProvider} size="md" />
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
              <Label htmlFor="st">Versicherungsstatus</Label>
              <Input id="st" value={insStatus} onChange={(e) => setInsStatus(e.target.value)} />
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
              <Label htmlFor="gender">Geschlecht</Label>
              <Input id="gender" value={gender} onChange={(e) => setGender(e.target.value)} placeholder="z. B. weiblich" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="street">Straße und Hausnummer</Label>
              <Input id="street" value={street} onChange={(e) => setStreet(e.target.value)} />
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
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2 border-t border-border/60 pt-3 mt-1">
              <p className="text-xs font-medium text-foreground">Weitere Versicherungsdaten</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="memsince">Mitglied / Versichert seit</Label>
              <Input id="memsince" type="date" value={insuranceMemberSince} onChange={(e) => setInsuranceMemberSince(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground">Behandlung</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dt">Datum</Label>
            <Input id="dt" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={errors.date ? "border-destructive" : ""} />
            {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
          </div>
          <div className="space-y-2 relative">
            <Label htmlFor="prov-name">Behandelnde:r</Label>
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
          <Label>Diagnose (Freitext)</Label>
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
          Speichern als Entwurf
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

function PatientStammdatenCard({ patient }: { patient: SandboxPatient }) {
  return (
    <div className="rounded-lg border border-border/80 bg-muted/15 p-4 space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stammdaten</p>
        <div className="mt-2">
          <StammdatenRow label="Geburtsdatum" value={patient.dob} />
          <StammdatenRow label="Geschlecht" value={patient.gender} />
          <StammdatenRow
            label="Adresse"
            value={
              [patient.street, [patient.postal_code, patient.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") ||
              undefined
            }
          />
          <StammdatenRow label="Telefon" value={patient.phone} />
          <StammdatenRow label="E-Mail" value={patient.email} />
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
          <StammdatenRow label="Mitglied seit" value={patient.insurance_member_since} />
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
          const href = inv ? `/sandbox/review/${inv.id}` : `/sandbox/analyse/${doc.id}`;
          const label = DOC_STATUS_LABEL[doc.status] ?? doc.status;
          return (
            <li key={doc.id}>
              <Link
                to={href}
                className="block rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-sm transition-colors hover:bg-muted/25"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular-nums text-muted-foreground">{doc.date}</span>
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
