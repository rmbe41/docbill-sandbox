import { useNavigate } from "react-router-dom";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import type { EncounterType, InsuranceType } from "@/lib/sandbox/types";
import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronsUpDown } from "lucide-react";

const GKV_LIST = [
  "BARMER",
  "Techniker Krankenkasse (TK)",
  "AOK Bayern",
  "DAK-Gesundheit",
  "ikk classic",
  "mhplus Betriebskrankenkasse",
  "BIG direkt gesund",
  "Knappschaft",
];

export default function SandboxNewDocPage() {
  const navigate = useNavigate();
  const { state, upsertPatient, addDocumentation } = useSandbox();
  const [tab, setTab] = useState("patient");

  const [patientMode, setPatientMode] = useState<"existing" | "new">("existing");
  const [existingPatientId, setExistingPatientId] = useState(state.patients[0]?.id ?? "");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [insNum, setInsNum] = useState("");
  const [insType, setInsType] = useState<InsuranceType>("GKV");
  const [insProvider, setInsProvider] = useState(GKV_LIST[0]!);
  const [insStatus, setInsStatus] = useState("Mitglied");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [providerId, setProviderId] = useState(state.providers[0]?.id ?? "");
  const [encounter, setEncounter] = useState<EncounterType>("Erstkontakt");
  const [anamnesis, setAnamnesis] = useState("");
  const [findings, setFindings] = useState("");
  const [diagnosisText, setDiagnosisText] = useState("");
  const [therapy, setTherapy] = useState("");

  const [patientComboOpen, setPatientComboOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sortedPatients = useMemo(() => [...state.patients].sort((a, b) => a.name.localeCompare(b.name)), [state.patients]);

  const fillTestData = useCallback(() => {
    const c = BILLING_CASES[Math.floor(Math.random() * BILLING_CASES.length)]!;
    const p = state.patients[Math.floor(Math.random() * state.patients.length)]!;
    setPatientMode("existing");
    setExistingPatientId(p.id);
    setDate(new Date().toISOString().slice(0, 10));
    setProviderId(state.providers[0]?.id ?? "");
    setEncounter(c.documentation.encounter_type);
    setAnamnesis(c.documentation.anamnesis);
    setFindings(c.documentation.findings);
    setDiagnosisText(c.documentation.diagnosis_text);
    setTherapy(c.documentation.therapy);
    setErrors({});
    setTab("behandlung");
  }, [state.patients, state.providers]);

  /** Liefert Patient:in-ID oder null; legt bei „neu“ genau eine:n Patient:in an. */
  const ensurePatientId = (): string | null => {
    if (patientMode === "existing") {
      if (!existingPatientId) return null;
      return existingPatientId;
    }
    if (!name.trim() || !dob.trim()) return null;
    const id = `sb-pat-${Date.now()}`;
    upsertPatient({
      id,
      name: name.trim(),
      dob: dob.trim(),
      insurance_number: insNum.trim() || "—",
      insurance_type: insType,
      insurance_provider: insType === "GKV" ? insProvider : insType === "PKV" ? "Privatversicherung (Beispiel)" : "Selbstzahler",
      insurance_status: insStatus,
    });
    return id;
  };

  const validateFields = (): boolean => {
    const e: Record<string, string> = {};
    if (patientMode === "existing") {
      if (!existingPatientId) e.patient = "Patient:in wählen";
    } else {
      if (!name.trim()) e.name = "Name erforderlich";
      if (!dob.trim()) e.dob = "Geburtsdatum erforderlich";
    }
    if (!date) e.date = "Datum erforderlich";
    if (!anamnesis.trim() && !findings.trim()) e.text = "Mindestens Anamnese oder Befund ausfüllen";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildDocPayload = (patientId: string) => {
    const idx =
      Math.abs((patientId + date + diagnosisText).split("").reduce((a, ch) => ((a << 5) - a + ch.charCodeAt(0)) | 0, 0)) %
      BILLING_CASES.length;
    const caseFromHash = BILLING_CASES[idx]!.id;
    return {
      id: `sb-doc-${Date.now()}`,
      patient_id: patientId,
      date,
      provider_id: providerId,
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
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patient:in unvollständig" }));
      return;
    }
    addDocumentation({ ...buildDocPayload(pid), status: "draft" });
    navigate("/sandbox/dokumentationen");
  };

  const saveAndPropose = () => {
    if (!validateFields()) return;
    const pid = ensurePatientId();
    if (!pid) {
      setErrors((prev) => ({ ...prev, patient: "Patient:in unvollständig" }));
      return;
    }
    const doc = { ...buildDocPayload(pid), status: "draft" as const };
    addDocumentation(doc);
    navigate(`/sandbox/analyse/${doc.id}`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-24">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Neue Dokumentation</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={fillTestData}>
          Testdaten generieren
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="patient">Patient:in</TabsTrigger>
          <TabsTrigger value="behandlung">Behandlung</TabsTrigger>
          <TabsTrigger value="preview">Vorschau</TabsTrigger>
        </TabsList>

        <TabsContent value="patient" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={patientMode === "existing" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setPatientMode("existing")}
            >
              Aus Stammdaten
            </Button>
            <Button
              type="button"
              variant={patientMode === "new" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setPatientMode("new")}
            >
              Neu anlegen
            </Button>
          </div>

          {patientMode === "existing" ? (
            <div className="space-y-2">
              <Label>Patient:in</Label>
              <Popover open={patientComboOpen} onOpenChange={setPatientComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", errors.patient && "border-destructive")}>
                    {existingPatientId ? sortedPatients.find((p) => p.id === existingPatientId)?.name : "Auswählen…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Suchen…" />
                    <CommandList>
                      <CommandEmpty>Nicht gefunden.</CommandEmpty>
                      <CommandGroup>
                        {sortedPatients.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.name}
                            onSelect={() => {
                              setExistingPatientId(p.id);
                              setPatientComboOpen(false);
                            }}
                          >
                            {p.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {errors.patient && <p className="text-xs text-destructive">{errors.patient}</p>}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nm">Name</Label>
                <Input id="nm" value={name} onChange={(e) => setName(e.target.value)} className={errors.name ? "border-destructive" : ""} />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
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
                  <Label>Krankenkasse</Label>
                  <Select value={insProvider} onValueChange={setInsProvider}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GKV_LIST.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
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
            </div>
          )}
        </TabsContent>

        <TabsContent value="behandlung" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dt">Datum</Label>
              <Input id="dt" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={errors.date ? "border-destructive" : ""} />
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
            <div className="space-y-2">
              <Label>Behandelnde:r</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.providers.map((pr) => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {pr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        </TabsContent>

        <TabsContent value="preview" className="mt-4 space-y-4">
          <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-sm space-y-3 whitespace-pre-wrap">
            <p className="font-medium">{patientMode === "existing" ? sortedPatients.find((p) => p.id === existingPatientId)?.name : name}</p>
            <p className="text-muted-foreground text-xs">{date}</p>
            <SeparatorMini />
            <Section title="Anamnese" body={anamnesis} />
            <Section title="Befund" body={findings} />
            <Section title="Diagnose" body={diagnosisText} />
            <Section title="Therapie" body={therapy} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={saveDraft}>
              Speichern als Entwurf
            </Button>
            <Button type="button" onClick={saveAndPropose}>
              Speichern &amp; Rechnung vorschlagen
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SeparatorMini() {
  return <div className="border-t border-border/70" />;
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
      <p>{body || "—"}</p>
    </div>
  );
}
