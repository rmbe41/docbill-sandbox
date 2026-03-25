# PDF-Ingest (DocBill)

## `ingest-cli.ts`

Liest eine PDF mit `pdfjs-dist` ein, sortiert Text-Items grob nach Lesereihenfolge (Y dann X) und schreibt:

- `manifest.json` – `document_id`, Seitenzahl, SHA-256, `truncated`
- `pages.json` – Seiten mit `reading_order_text`, `layout_quality`
- `chunks-preview.json` – nur Anzahl + Textanfang (keine Embeddings)

```bash
npx tsx scripts/pdf-ingest/ingest-cli.ts ./docs/beispiel.pdf ./out
```

Mehrspaltige Layouts können falsch sortieren; Seiten-JSON mit dem PDF-Viewer stichprobenweise prüfen.

## Optional: GOÄ `goae_catalog_snapshot`

Tabelle `public.goae_catalog_snapshot` (Migration `20260325140000_…`) kann per Script mit `src/data/goae-catalog-full.json` befüllt werden, wenn der Katalog ohne Edge-Redeploy aktualisiert werden soll:

```bash
npx tsx scripts/sync-goae-catalog-snapshot.ts
```

(Benötigt `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` in der Umgebung.)

## OCR / Scans

Nicht implementiert: bei reinen Scans zuerst OCR (z. B. externe Engine), dann dieselbe Chunk-Pipeline.

## Admin-Upload (Produktion)

`admin-context-upload` akzeptiert bereits extrahierten Text; Chunk-Metadaten `ziffern`, `source_page`/`section_path` können später beim PDF-Import befüllt werden. Umgebungsvariable `ADMIN_CONTEXT_MAX_CHUNKS` erhöht das Limit für große Dokumente.
