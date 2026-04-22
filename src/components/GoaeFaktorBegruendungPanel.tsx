import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Engine3Position } from "@/lib/engine3Result";
import { calculateAmountOrScaled, goaeFaktorLimits } from "@/lib/goae-validator";
import { goaeByZiffer } from "@/data/goae-catalog";
import { isFaktorUeberSchwelle, buildHoechstfaktorHinweisText } from "@/lib/format-goae-hinweis";
import { BegruendungBeispielePicker } from "@/components/BegruendungBeispielePicker";
import { getSteigerungFallbackBeispiel } from "@/lib/goae-begruendung-beispiele";
import { buildBegruendungsVorschlag } from "@/lib/begruendungsVorschlag";

const PRESET_FAKTOREN = [1.0, 1.8, 2.3, 2.5, 3.5];

function formatFaktorDe(n: number): string {
  return String(n).replace(".", ",");
}

function formatEuroDe(n: number): string {
  return `€${n.toFixed(2).replace(".", ",")}`;
}

type BlockProps = {
  p: Engine3Position;
  pBase: Engine3Position;
  rowKey: string;
  messageId?: string | null;
  beispieleTriple: string[];
  begruendungOverrides: Record<string, string>;
  setBegruendungOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  onRegenerateBegruendung: () => void | Promise<void>;
  regenerateLoading?: boolean;
  onFaktorCommit: (v: number) => void;
  /** Stapel-Panel: etwas schmaler */
  className?: string;
  readOnly?: boolean;
};

type Props = BlockProps & {
  stripeClass: string;
  trBorderClass?: string;
};

/** Spec 03 §5.2 – gleiche UI wie unter der Tabelle, auch im Batch-Seitenpanel nutzbar */
export function GoaeFaktorBegruendungBlock({
  p,
  pBase,
  rowKey,
  messageId,
  beispieleTriple,
  begruendungOverrides,
  setBegruendungOverrides,
  onRegenerateBegruendung,
  regenerateLoading = false,
  onFaktorCommit,
  className,
  readOnly = false,
}: BlockProps) {
  const fallbackTaRef = useRef<HTMLTextAreaElement>(null);
  const { min: fMin, max: fMax } = goaeFaktorLimits(pBase.ziffer);
  const sliderMax = Math.min(3.5, fMax);
  const sliderMin = fMin;
  const hoechst = goaeByZiffer.get(p.ziffer)?.hoechstfaktor ?? 3.5;
  const ueberHoechst = p.faktor > hoechst + 1e-9;
  const schwelle = goaeByZiffer.get(p.ziffer)?.schwellenfaktor ?? 2.3;
  const brauchtBegr = isFaktorUeberSchwelle(p.ziffer, p.faktor);

  const einfachsatz = useMemo(
    () => calculateAmountOrScaled(pBase.ziffer, 1, { betrag: pBase.betrag, faktor: pBase.faktor }),
    [pBase.ziffer, pBase.betrag, pBase.faktor],
  );
  const betragMax35 = useMemo(
    () => calculateAmountOrScaled(pBase.ziffer, Math.min(3.5, fMax), { betrag: pBase.betrag, faktor: pBase.faktor }),
    [pBase.ziffer, pBase.betrag, pBase.faktor, fMax],
  );

  const fallbackSteigerung = getSteigerungFallbackBeispiel({
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betragFormatted: formatEuroDe(p.betrag),
    quelleText: p.quelleText,
  });
  const effectiveText =
    begruendungOverrides[rowKey]?.trim() ||
    [p.begruendung, p.anmerkung].filter(Boolean).join(" · ").trim() ||
    beispieleTriple[0] ||
    fallbackSteigerung;

  const vorschlag = buildBegruendungsVorschlag(p, effectiveText);

  const onSlider = (vals: number[]) => {
    if (readOnly) return;
    const raw = vals[0];
    if (raw === undefined) return;
    const rounded = Math.round(raw * 10) / 10;
    onFaktorCommit(rounded);
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card/80 p-4 space-y-3 max-w-[920px]", className)}>
          <p className="text-sm font-semibold text-foreground border-b border-border/60 pb-2">
            GOÄ {p.ziffer}
          </p>
          <p className="text-xs text-muted-foreground">
            Aktueller Faktor: <span className="font-mono tabular-nums text-foreground">{formatFaktorDe(p.faktor)}</span>
          </p>

          <div className="space-y-2 pt-1">
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono tabular-nums px-0.5">
              <span>{formatFaktorDe(sliderMin)}</span>
              <span>{formatFaktorDe(sliderMax)}</span>
            </div>
            <Slider
              value={[Math.min(sliderMax, Math.max(sliderMin, p.faktor))]}
              min={sliderMin}
              max={sliderMax}
              step={0.1}
              disabled={readOnly}
              onValueChange={onSlider}
              className="w-full"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_FAKTOREN.map((preset) => {
                const clamped = Math.min(fMax, Math.max(fMin, Math.round(preset * 10) / 10));
                return (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] font-mono tabular-nums px-2"
                    disabled={readOnly}
                    onClick={() => (readOnly ? undefined : onFaktorCommit(clamped))}
                  >
                    [{formatFaktorDe(preset)}]
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Einfachsatz: <span className="text-foreground font-mono tabular-nums">{formatEuroDe(einfachsatz)}</span>
            </span>
            <span>│</span>
            <span>
              Aktuell: <span className="text-foreground font-mono tabular-nums">{formatEuroDe(p.betrag)}</span>
            </span>
            <span>│</span>
            <span>
              3,5x: <span className="text-foreground font-mono tabular-nums">{formatEuroDe(betragMax35)}</span>
            </span>
          </div>

          {ueberHoechst ? (
            <p className="text-xs font-medium text-red-900 dark:text-red-200 leading-snug">{buildHoechstfaktorHinweisText(p.ziffer, p.faktor)}</p>
          ) : null}

          {brauchtBegr ? (
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-snug">
              Ab Faktor {formatFaktorDe(schwelle)}: Begründung erforderlich (GOÄ 5.2.4)
            </p>
          ) : null}

          {brauchtBegr ? (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Begründung (KI-generiert):
              </p>
              {!vorschlag.istAusDokumentationAbleitbar ? (
                <p className="text-xs text-amber-800 dark:text-amber-200/95">
                  Diese Begründung konnte nicht aus Ihrer Dokumentation abgeleitet werden. Bitte passen Sie den Text an
                  Ihren konkreten Fall an.
                </p>
              ) : null}
              {beispieleTriple.length > 0 ? (
                <BegruendungBeispielePicker
                  key={`${messageId ?? "noid"}-${rowKey}-panel-${beispieleTriple[0]?.slice(0, 12)}`}
                  beispiele={beispieleTriple}
                  persistedText={begruendungOverrides[rowKey]}
                  onTextChange={(t) => setBegruendungOverrides((prev) => ({ ...prev, [rowKey]: t }))}
                  onRegenerate={() => void onRegenerateBegruendung()}
                  regenerateLoading={regenerateLoading}
                  surface="warnung"
                  readOnly={readOnly}
                />
              ) : (
                <div className="space-y-2">
                  <Textarea
                    ref={fallbackTaRef}
                    value={begruendungOverrides[rowKey] ?? fallbackSteigerung}
                    readOnly={readOnly}
                    onChange={(e) =>
                      readOnly
                        ? undefined
                        : setBegruendungOverrides((prev) => ({ ...prev, [rowKey]: e.target.value }))
                    }
                    rows={6}
                    className="text-xs leading-snug min-h-[120px] font-sans"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      disabled={readOnly || regenerateLoading}
                      onClick={() => void onRegenerateBegruendung()}
                    >
                      {regenerateLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      Neu generieren
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={readOnly}
                      onClick={() => {
                        fallbackTaRef.current?.focus();
                        fallbackTaRef.current?.select();
                      }}
                    >
                      Bearbeiten
                    </Button>
                  </div>
                </div>
              )}
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">ℹ Essentiell für Begründungen:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {vorschlag.hinweise.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
    </div>
  );
}

export function GoaeFaktorBegruendungPanel({
  p,
  pBase,
  rowKey,
  messageId,
  beispieleTriple,
  begruendungOverrides,
  setBegruendungOverrides,
  onRegenerateBegruendung,
  regenerateLoading = false,
  onFaktorCommit,
  stripeClass,
  trBorderClass = "border-b-0",
}: Props) {
  return (
    <tr className={trBorderClass}>
      <td colSpan={7} className={cn("py-3 px-2", stripeClass)}>
        <GoaeFaktorBegruendungBlock
          p={p}
          pBase={pBase}
          rowKey={rowKey}
          messageId={messageId}
          beispieleTriple={beispieleTriple}
          begruendungOverrides={begruendungOverrides}
          setBegruendungOverrides={setBegruendungOverrides}
          onRegenerateBegruendung={onRegenerateBegruendung}
          regenerateLoading={regenerateLoading}
          onFaktorCommit={onFaktorCommit}
        />
      </td>
    </tr>
  );
}
