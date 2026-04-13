# GOAE v2 Builder Pipeline

Der v2-Builder erzeugt eine KI-taugliche GOAE-JSON mit normalisierten Kernobjekten.

## Ausfuehrung

```bash
npm run goae:build:v2 -- \
  --goae-pdf "/pfad/GOAE.pdf" \
  --pkv-pdf "/pfad/PKV-Kommentierung.pdf"
```

## Pipeline-Schritte

1. Laden des Legacy-Katalogs aus `src/data/goae-catalog-full.json`.
2. Mapping der v1-Ziffern auf `codes` inkl. strukturierter `billingExclusions`.
3. Aufbau von `sections` und globalen `rules` (inkl. `analog_restriction`, `zielleistungsprinzip`).
4. Extraktion von `analogMappings` aus PKV-PDF.
5. Aufbau von `termIndex` und denormalisiertem `searchIndex`.
6. Zod-Validierung gegen `src/data/goae-catalog-v2-schema.ts`.
7. Schreiben der Ausgaben:
   - `src/data/goae-catalog-v2.json`
   - `src/data/goae-catalog-v2-meta.json`
   - `supabase/functions/goae-chat/goae-catalog-v2.json`

