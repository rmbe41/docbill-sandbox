# GOAE Engine Benchmark

Dieses Verzeichnis enthaelt ein reproduzierbares Benchmark-Setup fuer den Vergleich von:

- `simple`
- `complex`
- `engine3`
- `engine3_1`

## Inhalte

- `schema/case.schema.json`: Struktur einzelner Benchmark-Cases.
- `schema/result.schema.json`: Struktur normalisierter Engine-Resultate.
- `config/weights.json`: Gewichte fuer Scoring und Release-Gates.
- `cases/starter-cases.json`: Starter-Set mit mehreren Faellen verschiedener Schwierigkeit.

## Ziel

Fuer jeden Testfall ist ein Goldstandard hinterlegt:

- erwartete Findings (`category`, `severity`, `codeRefs`)
- erwarteter korrigierter Entwurf
- erwartete Betraege
- notwendige Evidenz (`legalRefs`, `sourceRefs`)

Damit koennen Engines objektiv gegen denselben Referenzstand bewertet werden.

