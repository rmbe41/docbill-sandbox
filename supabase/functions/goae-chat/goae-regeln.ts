export const GOAE_ANALOGE_BEWERTUNG = `
# Analoge Bewertung nach § 6 Abs. 2 GOÄ – Schritt-für-Schritt-Anleitung

## Wann wird analog abgerechnet?
Wenn eine erbrachte ärztliche Leistung NICHT im GOÄ-Gebührenverzeichnis aufgeführt ist, darf sie gemäß § 6 Abs. 2 GOÄ „entsprechend einer nach Art, Kosten- und Zeitaufwand gleichwertigen Leistung" berechnet werden.

## 5-Schritte-Verfahren:

### Schritt 1: Leistung bestimmen
Definiere die erbrachte Leistung genau (z.B. "SD-OCT des Augenhintergrundes", "Crosslinking der Hornhaut").

### Schritt 2: Vergleichbare GOÄ-Leistung finden
Suche in der GOÄ nach einer Leistung, die zeitlich, in Aufwand und medizinischem Zweck ähnlich ist.
Beispiele:
- SD-OCT → analog Nr. 1249 (Fluoreszenzangiographie) oder A7011
- Crosslinking → analog Nr. 1340 (Thermo-/Kryotherapie)
- Intravitreale Injektion (IVOM) → Nr. 1386 (Injektion) + ggf. Nr. 1249 analog (OCT-Kontrolle)
- Photodynamische Therapie → analog Nr. 1365 (Lichtkoagulation)

### Schritt 3: Analogie kennzeichnen
Im Abrechnungstext MUSS klar „analog" oder „entsprechend" vermerkt werden:
Format: „GOÄ Nr. XXXX analog – [Beschreibung der tatsächlich erbrachten Leistung]"
Beispiel: „GOÄ Nr. 1249 analog – SD-OCT Untersuchung des Augenhintergrundes"

### Schritt 4: Steigerungsfaktor wählen
Der Steigerungsfaktor richtet sich nach dem Gebührenrahmen der gewählten Analogziffer:
- Persönliche ärztliche Leistungen: 1,0 – 3,5× (Schwelle 2,3×)
- Medizinisch-technische Leistungen (Abschnitt A, E, O): 1,0 – 2,5× (Schwelle 1,8×)
- Labor (Abschnitt M): 1,0 – 1,3× (Schwelle 1,15×)

Über dem Schwellenwert: Begründung PFLICHT! Orientierung:
- Schwierigkeit der Leistung
- Zeitaufwand
- Umstände der Durchführung

### Schritt 5: Dokumentation
Für Prüfer (z.B. Privatkassen, Beihilfe) ist eine Begründung erforderlich:
- Warum keine reguläre GOÄ-Ziffer passt
- Welche Ziffer als Analogie gewählt wurde und warum sie gleichwertig ist
- Besonderheiten der Leistung (Art, Kosten- und Zeitaufwand)
`;

export const GOAE_BEGRUENDUNGEN = `
# Steigerungsfaktor-Begründungen – Leitfaden

## Grundsatz
Der Schwellenwert ist der Steigerungsfaktor, bis zu dem KEINE Begründung nötig ist:
- Ärztliche Leistungen: Schwellenwert 2,3× (max 3,5×)
- Technische Leistungen (Abschnitt A, E, O): Schwellenwert 1,8× (max 2,5×)
- Labor (Abschnitt M): Schwellenwert 1,15× (max 1,3×)

Der Schwellenwert ist der DURCHSCHNITT – überdurchschnittlich schwierige Leistungen SOLLEN über dem Schwellenwert abgerechnet werden!

## Bemessungskriterien (§ 5 Abs. 2 GOÄ)
1. **Schwierigkeit** der einzelnen Leistung (auch durch Schwierigkeit des Krankheitsfalls)
2. **Zeitaufwand** der einzelnen Leistung
3. **Umstände bei der Ausführung**

## GEEIGNETE Begründungen

### Überdurchschnittlicher Zeitaufwand (Anamnese/Beratung)
- Schwere der Grunderkrankung
- Aufwändige Beratung zu verschiedenen Therapieoptionen
- Komplizierte Begleiterkrankung(en)
- Wechselwirkungsproblematik bei Mehrfachmedikationen
- Häufig wechselndes Beschwerdebild
- Berücksichtigung umfangreicher Fremdbefunde
- Erschwerte Verständigung (Sprachbarriere, Schwerhörigkeit)
HINWEIS: Die Dauer sollte in der Begründung angegeben werden (z.B. „Beratungsdauer 25 Min.")

### Erschwerte Untersuchungsbedingungen
- Ausgeprägte Entzündung
- Starke Schwellung
- Starke Blutungen und/oder Verkrustungen
- Multiple Verletzungen
- Schmerzbedingte Abwehrhaltung des Patienten
- Eingeschränkte Compliance (z.B. Kleinkind, Demenz)

### Überdurchschnittlicher Leistungsumfang
- Schwierige Differenzialdiagnostik bei unklaren Befunden
- Erhöhter Zeitaufwand wegen vieler Begleiterkrankungen
- Zusätzliche Untersuchungsgebiete außerhalb des Organsystems
- Untersuchung mehrerer Lokalisationen/Symptome
- Schwierige medikamentöse Einstellung
- Zeitaufwändige Lagerung wegen Schmerzen/Immobilität
- Erschwerte Leistungserbringung beim Säugling oder Kleinkind

### Spezifisch für Augenheilkunde
- Ausgeprägte Linsentrübung mit erschwerter Funduskopie
- Multiple Pathologien der Netzhaut
- Hohe Myopie/Hyperopie mit erschwerter Refraktionsbestimmung
- Kleine Pupille / schlechte Mydriasis
- Nystagmus mit erschwerter Untersuchung
- Unruhiger Patient (z.B. bei Kindern)
- Komplexe Kombination von Vorder- und Hinterabschnittspatholgie
- Beidseitige unterschiedliche Befunde erfordern separate Analyse

## UNGEEIGNETE Begründungen (werden von Prüfern abgelehnt!)
- Hohe Praxiskosten
- Besondere Ausstattung
- Hoher Sachkostenanteil
- Unterbewertung einer Leistung / alte GOÄ
- Eigene fachliche Kapazität
- Höchstpersönliche Leistungserbringung
- Leerformeln wie „hoher technischer Aufwand" oder nur „erhöhter Zeitaufwand" ohne Konkretes

## Muster-Begründungsformulierungen

### Faktor über Schwellenwert – Standard
„Aufgrund [der überdurchschnittlichen Schwierigkeit / des erhöhten Zeitaufwands / der besonderen Umstände] bei [konkrete Diagnose/Situation einfügen] und einem Zeitaufwand von ca. [XX] Min. ist ein Steigerungsfaktor von [X,X]× gemäß § 5 Abs. 2 GOÄ gerechtfertigt."

### Spaltlampe/Funduskopie mit erschwerter Untersuchung
„Erhöhter diagnostischer Aufwand durch [ausgeprägte Linsentrübung / enge Pupille / multiple Netzhautpathologien / starke Glaskörpertrübungen], die eine verlängerte und vertiefte Untersuchung erforderten."

### Beratung
„Eingehende Beratung von [XX] Min. Dauer aufgrund [schwerer Grunderkrankung / multipler Therapieoptionen / komplizierter Begleiterkrankungen]. Erläuterung von [OP-Risiken / Therapiealternativen / Prognose]."

### Operative Leistung
„Erschwerter Zugang / verlängerte OP-Dauer von [XX] Min. aufgrund [anatomischer Besonderheiten / fortgeschrittenem Krankheitsstadium / intraoperativer Komplikation: konkret benennen]."

## Kompakte Begründungen für UI (max. ~140 Zeichen)

Für Tabellen und Vorschlags-Boxen: fachlich einwandfrei, aber kurz. Keine Leerformeln.

- **Beratung:** „Eingehende Beratung von ca. 15–20 Min. aufgrund [Diagnose]. Faktor X× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.“
- **Spaltlampe/Fundus:** „Erhöhter diagnostischer Aufwand durch [Diagnose] (erschwerte Darstellung). Faktor X× gerechtfertigt.“
- **Refraktion:** „Erschwerte Refraktion bei [Diagnose]. Faktor X× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.“
- **Operativ:** „Erschwerter Zugang/verlängerte OP bei [Diagnose]. Faktor X× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.“
`;

export const GOAE_ABSCHNITTE = `
# GOÄ-Abschnitte – Übersicht

## A: Gebühren in besonderen Fällen
Gebührenrahmen: 1,0 – 2,5× (Schwelle 1,8×)
Regelungen für besondere Abrechnungssituationen.

## B: Grundleistungen und allgemeine Leistungen (Ziffern 1–109)
Gebührenrahmen: 1,0 – 3,5× (Schwelle 2,3×)
Beratungen (Nr. 1–4), Untersuchungen (Nr. 5–8), Visiten (Nr. 45–46), Berichte (Nr. 70–96), Bescheinigungen etc.

## C: Nichtgebietsbezogene Sonderleistungen (Ziffern 200–449)
Gebührenrahmen: 1,0 – 3,5× (Schwelle 2,3×) bzw. 1,0 – 2,5× für techn. Leistungen
Injektionen, Infusionen, Punktionen, Biopsien, etc.
Für Augenärzte relevant: Nr. 200 (Verband), Nr. 250 (Blutentnahme), Nr. 252 (Injektion s.c./i.m./i.c.), Nr. 253 (Injektion i.v.)

## D: Anästhesieleistungen (Ziffern 450–498)
Narkosen, Lokalanästhesien. Für Augenärzte relevant bei OP-Leistungen.

## E: Physikalisch-medizinische Leistungen (Ziffern 500–569)
Gebührenrahmen: 1,0 – 2,5× (Schwelle 1,8×)

## F: Innere Medizin, Kinderheilkunde, Dermatologie (Ziffern 600–793)
Sonographien, EKG, Endoskopien etc.

## G: Neurologie, Psychiatrie und Psychotherapie (Ziffern 800–887)
Für Augenärzte relevant: Nr. 800/801 (neurologische Untersuchung, ggf. bei Neuro-Ophthalmologie)

## H: Geburtshilfe und Gynäkologie (Ziffern 1001–1168)

## I: Augenheilkunde (Ziffern 1200–1386)
Gebührenrahmen: 1,0 – 3,5× (Schwelle 2,3×) für ärztliche Leistungen
Tonometrie (Nr. 1255–1257): Gebührenrahmen 1,0 – 2,5× (Schwelle 1,8×) – medizinisch-technisch
Unterabschnitte:
- Refraktion & Optik (1200–1215)
- Kontaktlinsen (1210–1215)
- Motilität & Binokularsehen (1216–1218)
- Gesichtsfeld (1225–1227)
- Farbsinn & Adaptation (1228–1237)
- Spaltlampe & Fundus (1240–1244)
- Fluoreszenz (1248–1249)
- Tonometrie (1255–1263)
- Fremdkörperentfernung (1275–1281)
- Lidchirurgie (1282–1312)
- Tränenwege (1293–1301)
- Hornhaut (1321–1347)
- Katarakt/Linse (1348–1356)
- Glaukom (1357–1362)
- Netzhaut/Vitrektomie (1365–1369)
- Enukleation/Prothese (1370–1375)
- Laser (1380–1383)
- IVOM (1386)

## J: Hals-, Nasen-, Ohrenheilkunde (Ziffern 1400–1639)

## K: Urologie (Ziffern 1700–1860)

## L: Chirurgie, Orthopädie (Ziffern 2000–3321)
Für Augenärzte relevant: Nr. 2000 (Erstversorgung kleine Wunde), Nr. 2003 (große Wunde), Nr. 2005 (Naht)

## M: Laboratoriumsuntersuchungen (Ziffern 3500–4787)
Gebührenrahmen: 1,0 – 1,3× (Schwelle 1,15×)

## N: Histologie, Zytologie und Zytogenetik (Ziffern 4800–4873)

## O: Strahlendiagnostik, Nuklearmedizin, MRT und Strahlentherapie (Ziffern 5000–5855)
Gebührenrahmen: 1,0 – 2,5× (Schwelle 1,8×)
Für Augenärzte relevant: Nr. 5000 (Röntgen Schädel), Nr. 5090 (CT Kopf), Nr. 5370 (MRT Kopf), Nr. 5855 (Strahlentherapie Auge)

## P: Sektionsleistungen (Ziffern 6000–6018)
`;
