import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ──────────────────────────────────────────────────────────────
// Kompakter GOÄ-Katalog als RAG-Kontext
// Format: Ziffer|Bezeichnung|Punkte|1×|Schwelle→Regel|Max→Höchst|Ausschluss|Hinweise
// ──────────────────────────────────────────────────────────────
const GOAE_KATALOG = `
# GOÄ-Ziffernkatalog 2026 – Kompaktreferenz
## Punktwert: 0,0582873 € (aktuell)

## Steigerungsfaktoren
- Persönliche ärztl. Leistungen: Schwelle 2,3× (max 3,5×)
- Medizinisch-technische Leistungen: Schwelle 1,8× (max 2,5×)
- Laborleistungen Abschnitt M: Schwelle 1,15× (max 1,3×)
- Über Schwellenwert: schriftliche Begründung erforderlich

## Abschnitt B – Grundleistungen
1|Beratung – auch mittels Fernsprecher|80|4,66€|2,3→10,72€|3,5→16,32€|Ausschl: 2,3,20-34,45,46,48,50,51,376-378,435,448,449,804,806-808,812,817,835,849,861-864,870,871,886,887,K1
2|Ausstellung Wiederholungsrezepte/Überweisungen/Befundübermittlung durch Arzthelferin|30|1,75€|1,8→3,15€|2,5→4,37€|Nicht mit anderen Gebühren zusammen berechenbar
3|Eingehende Beratung (mind. 10 Min)|150|8,74€|2,3→20,11€|3,5→30,60€|Nur als einzige Leistung oder mit 5,6,7,8,800,801
4|Fremdanamnese/Unterweisung Bezugsperson|220|12,82€|2,3→29,49€|3,5→44,88€|Im Behandlungsfall nur 1× berechnungsfähig|Ausschl: 3,15,20,21,25,26,30,31,34,45,46,70,435,448,449,801,806,807,816,817,835
5|Symptombezogene Untersuchung|80|4,66€|2,3→10,72€|3,5→16,32€|Ausschl: 6,7,8,23-29,45,46,50,51,61,435,448,449,600,601,1203,1204,1210-1213,1217,1228,1240,1400,1401,1414
6|Vollständige Untersuchung eines Organsystems|100|5,83€|2,3→13,41€|3,5→20,40€|Bei Augen: beidseitig alle Abschnitte|Ausschl: 5,7,8,25-29,45,46,61,435,448,449,600,601,1203,1204,1210-1213,1217,1228,1240,1400,1401,1414
7|Vollständige Untersuchung (Haut/Stütz-Bewegung/Brust/Bauchorgane)|160|9,33€|2,3→21,45€|3,5→32,64€|Ausschl: 5,6,8,23-29,45,46,61,435,448,449,600,601,1203,1204,1228,1240,1400,1401,1414,1730
8|Ganzkörperstatus|260|15,15€|2,3→34,86€|3,5→53,03€|Ausschl: 5,6,7

## Abschnitt I – Augenheilkunde
### Refraktion & Optik
1200|Subjektive Refraktion mit sphärischen Gläsern|59|3,44€|2,3→7,91€|3,5→12,04€|Ausschl: 1201
1201|Subjektive Refraktion mit sphärisch-zylindrischen Gläsern|89|5,19€|2,3→11,93€|3,5→18,16€|Ausschl: 1200
1202|Objektive Refraktion (Skiaskopie/Refraktometer)|74|4,31€|2,3→9,92€|3,5→15,10€|Ausschl: 1210-1213
1203|Akkommodationsmessung|60|3,50€|2,3→8,04€|3,5→12,24€|Ausschl: 5,6,7,8
1204|Hornhautkrümmungsradien|45|2,62€|2,3→6,03€|3,5→9,18€|Ausschl: 5,6,7,8,1210-1213
1207|Prüfung Mehrstärken-/Prismenbrillen|70|4,08€|2,3→9,38€|3,5→14,28€
1209|Tränensekretion (Schirmer-Test)|20|1,17€|2,3→2,68€|3,5→4,08€|Kosten abgegolten

### Kontaktlinsen
1210|Erstanpassung Kontaktlinse ein Auge|228|13,29€|2,3→30,57€|3,5→46,51€|Ausschl: 5,6,1202,1211,1213,1240
1211|Erstanpassung Kontaktlinsen beide Augen|300|17,49€|2,3→40,22€|3,5→61,20€|Ausschl: 5,6,1202,1204,1210,1212,1213,1240
1212|Kontrolle Kontaktlinse ein Auge|132|7,69€|2,3→17,70€|3,5→26,93€|Ausschl: 5,6,1202,1204,1210,1211,1213,1240
1213|Kontrolle Kontaktlinsen beide Augen|198|11,54€|2,3→26,54€|3,5→40,39€|Ausschl: 5,6,1202,1204,1210,1211,1212,1240
1215|Fernrohr-/Lupenbrillen je Sitzung|121|7,05€|2,3→16,22€|3,5→24,68€

### Motilität & Binokularsehen
1216|Heterophorie/Strabismus-Untersuchung|91|5,30€|2,3→12,20€|3,5→18,56€
1217|Quali-/quantitative Untersuchung Binokularsehen|242|14,11€|2,3→32,44€|3,5→49,37€|Ausschl: 5,6
1218|Differenzierende Analyse Augenbewegung (≥36 Blickrichtungen)|700|40,80€|2,3→93,84€|3,5→142,80€|Ausschl: 1268-1270

### Gesichtsfeld
1225|Kampimetrie/Perimetrie nach Förster|121|7,05€|2,3→16,22€|3,5→24,68€
1226|Projektionsperimetrie|182|10,61€|2,3→24,40€|3,5→37,13€|Ausschl: 1227
1227|Statische Profilperimetrie|248|14,46€|2,3→33,25€|3,5→50,59€|Ausschl: 1226

### Farbsinn & Adaptation
1228|Farbsinnprüfung Pigmentproben|61|3,56€|2,3→8,18€|3,5→12,44€|Ausschl: 5,6,7,8
1229|Farbsinnprüfung Anomaloskop|182|10,61€|2,3→24,40€|3,5→37,13€
1233|Vollständige Adaptationsuntersuchung|484|28,21€|2,3→64,89€|3,5→98,74€|Ausschl: 1234,1235,1236
1234|Dämmerungssehen ohne Blendung|91|5,30€|2,3→12,20€|3,5→18,56€|Ausschl: 1236
1235|Dämmerungssehen während Blendung|91|5,30€|2,3→12,20€|3,5→18,56€|Ausschl: 1233
1236|Dämmerungssehen nach Blendung (Readaptation)|91|5,30€|2,3→12,20€|3,5→18,56€|Ausschl: 1233
1237|ERG und/oder VEP|600|34,97€|2,3→80,44€|3,5→122,40€

### Spaltlampe & Fundus
1240|Spaltlampenmikroskopie|74|4,31€|2,3→9,92€|3,5→15,10€|Ausschl: 5,6,7,8,1210-1213,1242
1241|Gonioskopie|152|8,86€|2,3→20,38€|3,5→31,01€
1242|Binokulare Fundusuntersuchung inkl. Peripherie|152|8,86€|2,3→20,38€|3,5→31,01€|Ausschl: 1240
1243|Diasklerale Durchleuchtung|61|3,56€|2,3→8,18€|3,5→12,44€
1244|Exophthalmometrie|50|2,91€|2,3→6,70€|3,5→10,20€

### Fluoreszenz
1248|Fluoreszenzuntersuchung Augenhintergrund|242|14,11€|2,3→32,44€|3,5→49,37€|Ausschl: 253,1249
1249|Fluoreszenzangiographie|484|28,21€|2,3→64,89€|3,5→98,74€|Ausschl: 253,1248|Kosten abgegolten

### Tonometrie (med.-techn. Schwelle 1,8×)
1255|Impressionstonometrie|70|4,08€|1,8→7,34€|2,5→10,20€|Ausschl: 1256,1257,1262,1263
1256|Applanationstonometrie|100|5,83€|1,8→10,49€|2,5→14,57€|Ausschl: 1255,1257,1262,1263
1257|Tonometrische Kurven (≥4 Messungen)|242|14,11€|1,8→25,39€|2,5→35,26€|Ausschl: 1255,1256,1262,1263

### Fremdkörperentfernung
1275|Oberflächliche FK Bindehaut/Hornhaut|37|2,16€|2,3→4,96€|3,5→7,55€|Ausschl: 200,1276,1277,1278
1276|Instrumentelle FK-Entfernung Hornhaut/Lederhaut|74|4,31€|2,3→9,92€|3,5→15,10€|Ausschl: 200,1275,1277,1278
1277|Eisenhaltige FK mit Ausfräsung Rostring|152|8,86€|2,3→20,38€|3,5→31,01€|Ausschl: 200,1275,1276,1278
1278|Eingespießte FK Hornhaut mittels Präparation|278|16,20€|2,3→37,27€|3,5→56,71€|Ausschl: 200,1275,1276,1277
1280|FK aus Augeninnern (Magnet)|1290|75,19€|2,3→172,94€|3,5→263,17€|Ausschl: 1281
1281|Nichtmagnetische FK/Geschwulst aus Augeninnern|2220|129,40€|2,3→297,61€|3,5→452,89€

### Lidchirurgie
1282|Geschwulst/Kalkinfarkte aus Lidern|152|8,86€|2,3→20,38€|3,5→31,01€
1302|Plastische Korrektur Lidspalte/Epikanthus|924|53,86€|2,3→123,87€|3,5→188,50€
1304|Plastische Korrektur Ektropium/Entropium|924|53,86€|2,3→123,87€|3,5→188,50€
1305|Ptosis-OP|739|43,07€|2,3→99,07€|3,5→150,76€|Ausschl: 1306
1306|Ptosis-OP mit Lidheberverkürzung|1110|64,70€|2,3→148,81€|3,5→226,45€|Ausschl: 1305
1310|Lidplastik freies Hauttransplantat|1480|86,27€|2,3→198,41€|3,5→301,93€|Ausschl: 1311,1312
1311|Lidplastik Hautlappenverschiebung|1110|64,70€|2,3→148,81€|3,5→226,45€|Ausschl: 1310,1312
1312|Lidplastik Verschiebung + Transplantation|1850|107,83€|2,3→248,01€|3,5→377,41€|Ausschl: 1310,1311

### Tränenwege
1293|Dehnung/Durchspülung/Sondierung Tränenwege|74|4,31€|2,3→9,92€|3,5→15,10€|Ausschl: 1294,1297
1294|Sondierung Tränennasengang Säuglinge|130|7,58€|2,3→17,43€|3,5→26,52€
1299|Tränensackexstirpation|554|32,29€|2,3→74,27€|3,5→113,02€
1300|Tränensack-OP Wiederherstellung Abfluss|1220|71,11€|2,3→163,55€|3,5→248,89€
1301|Exstirpation/Verödung Tränendrüse|463|26,99€|2,3→62,07€|3,5→94,45€

### Hornhaut
1321|Operation Flügelfell|296|17,25€|2,3→39,68€|3,5→60,39€
1322|Flügelfell mit lamellierender Keratoplastik|1660|96,76€|2,3→222,54€|3,5→338,65€
1325|Naht Bindehaut/nicht perforierende Hornhautwunde|230|13,41€|2,3→30,83€|3,5→46,92€|Ausschl: 1326-1328
1326|Naht perforierende Hornhautwunde|1110|64,70€|2,3→148,81€|3,5→226,45€|Ausschl: 1325,1327,1328
1338|Chemische Ätzung Hornhaut|56|3,26€|2,3→7,51€|3,5→11,42€|Ausschl: 200,1339,1340
1339|Abschabung Hornhaut|148|8,63€|2,3→19,84€|3,5→30,19€|Ausschl: 200,1338,1340
1340|Thermo-/Kryotherapie Hornhauterkrankungen|185|10,78€|2,3→24,80€|3,5→37,74€|Ausschl: 1339
1345|Hornhautplastik|1660|96,76€|2,3→222,54€|3,5→338,65€
1346|Hornhauttransplantation|2770|161,46€|2,3→371,35€|3,5→565,10€
1347|Keratoprothese|3030|176,61€|2,3→406,20€|3,5→618,14€

### Katarakt / Linse
1348|Diszision Linse/Nachstar|832|48,50€|2,3→111,54€|3,5→169,73€|Ausschl: 1354,1355
1349|Weicher Star (Saug-Spül)|1850|107,83€|2,3→248,01€|3,5→377,41€|Ausschl: 1350,1351,1362
1350|Staroperation|2370|138,14€|2,3→317,72€|3,5→483,49€|Ausschl: 1348,1349,1351,1358
1351|Star-OP mit IOL-Implantation|2770|161,46€|2,3→371,35€|3,5→565,10€|Ausschl: 1350
1352|IOL-Einpflanzung selbständig|1800|104,92€|2,3→241,31€|3,5→367,21€
1353|IOL-Extraktion|832|48,50€|2,3→111,54€|3,5→169,73€
1354|Extraktion luxierte Linse|2220|129,40€|2,3→297,61€|3,5→452,89€
1355|Extraktion Nachstar|1110|64,70€|2,3→148,81€|3,5→226,45€

### Glaukom
1357|Hintere Sklerotomie|370|21,57€|2,3→49,60€|3,5→75,48€|Ausschl: 1358-1362
1358|Zyklodialyse/Iridektomie|1000|58,29€|2,3→134,06€|3,5→204,01€|Ausschl: 1350,1351,1359-1362,1380,1381
1359|Zyklodiathermie/Kryozyklothermie|500|29,14€|2,3→67,03€|3,5→102,00€
1360|Lasertrabekuloplastik|1000|58,29€|2,3→134,06€|3,5→204,01€|Ausschl: 1357-1359,1361,1362
1361|Fistelbildende OP bei Glaukom|1850|107,83€|2,3→248,01€|3,5→377,41€|Ausschl: 1357-1360,1362,1382
1362|Kombinierte Star/Glaukom-OP|3030|176,61€|2,3→406,20€|3,5→618,14€|Ausschl: 1349-1352,1357-1361

### Netzhaut / Vitrektomie
1365|Lichtkoagulation Netzhaut je Sitzung|924|53,86€|2,3→123,87€|3,5→188,50€|Ausschl: 1361,1366-1369
1366|Vorbeugende OP Netzhautablösung|1110|64,70€|2,3→148,81€|3,5→226,45€|Ausschl: 1365,1367-1369
1367|Netzhautablösung mit Eindellen|2220|129,40€|2,3→297,61€|3,5→452,89€|Ausschl: 1365,1366,1368,1369
1368|Netzhautablösung + Glaskörperchirurgie|3030|176,61€|2,3→406,20€|3,5→618,14€|Ausschl: 1365-1367,1369
1369|Glaskörperoperation (Vitrektomie)|3030|176,61€|2,3→406,20€|3,5→618,14€|Ausschl: 1365-1368

### Enukleation / Prothese
1370|Enukleation|554|32,29€|2,3→74,27€|3,5→113,02€|Ausschl: 1372
1371|Enukleation mit Einpflanzung Plombe|832|48,50€|2,3→111,54€|3,5→169,73€
1372|Exenteration Orbita|1480|86,27€|2,3→198,41€|3,5→301,93€|Ausschl: 1370
1373|Eviszeration Bulbus|554|32,29€|2,3→74,27€|3,5→113,02€
1375|Einpflanzung Augenprothese|463|26,99€|2,3→62,07€|3,5→94,45€
1380|Nachstarlaserung (YAG)|600|34,97€|2,3→80,44€|3,5→122,40€
1381|Laser-Iridotomie|600|34,97€|2,3→80,44€|3,5→122,40€
1382|Zyklophotokoagulation|600|34,97€|2,3→80,44€|3,5→122,40€
1383|Vitreolyse|600|34,97€|2,3→80,44€|3,5→122,40€
1386|Intravitreale Injektion|252|14,69€|2,3→33,79€|3,5→51,42€

## Weitere häufig verwendete GOÄ-Ziffern (Kurzreferenz)

### Abschnitt C – Nichtgebietsbezogene Sonderleistungen
200|Verband|25|1,46€|1,8→2,62€|2,5→3,64€
250|Blutentnahme|40|2,33€|1,8→4,20€|2,5→5,83€
252|Injektion subkutan/intrakutan/intramuskulär|25|1,46€|1,8→2,62€|2,5→3,64€
253|Injektion intravenös|70|4,08€|1,8→7,34€|2,5→10,20€

### Abschnitt E – Physikalisch-medizinische Leistungen
500|Inhalationstherapie|38|2,21€|1,8→3,99€|2,5→5,54€
530|Krankengymnastik Einzelbehandlung|100|5,83€|1,8→10,49€|2,5→14,57€

### Abschnitt L – Chirurgie, Orthopädie (häufig bei Augen-OPs relevant)
2000|Erstversorgung kleine Wunde|70|4,08€|2,3→9,38€|3,5→14,28€
2003|Erstversorgung große Wunde|148|8,63€|2,3→19,84€|3,5→30,19€
2005|Naht|148|8,63€|2,3→19,84€|3,5→30,19€

### Abschnitt N – Strahlendiagnostik, -therapie
5000|Röntgen Schädel|200|11,66€|1,8→20,98€|2,5→29,14€
5090|CT Kopf|1200|69,94€|1,8→125,90€|2,5→174,86€
5370|MRT Kopf|2800|163,21€|1,8→293,78€|2,5→408,03€

### Abschnitt O – Strahlenbehandlung  
5855|Strahlentherapie Augenbereich|600|34,97€|1,8→62,95€|2,5→87,43€

## Wichtige GOÄ-Abrechnungsregeln
1. Ausschlussziffern beachten: Bestimmte Ziffern dürfen nicht zusammen abgerechnet werden
2. Steigerungsbegründung: Über Schwellenwert (2,3× bzw. 1,8×) erfordert individuelle Begründung
3. Zielleistungsprinzip: Teilschritte einer OP werden nicht separat berechnet
4. Analogbewertung: Nicht gelistete Leistungen → analoge Ziffer mit Begründung
5. Zeitfaktor: Bei Nr. 3 (Beratung) mindestens 10 Minuten erforderlich
6. Behandlungsfall: = Zeitraum von 1 Monat nach Erstkontakt
7. Sitzungsdefinition: Zusammenhängende Leistungen an einem Tag
8. OCT (SD-OCT): Analog Nr. 1249 oder A7011 je nach Indikation
9. Intravitreale Injektionen (IVOM): Nr. 1386 (Injektion) + ggf. Nr. 1249 (Kontrolle)
10. Photodynamische Therapie: Nr. 1365 analog
`;

const SYSTEM_PROMPT = `Du bist GOÄ-DocBilling, ein KI-Assistent für die Abrechnung nach der Gebührenordnung für Ärzte (GOÄ).

DEINE KERNKOMPETENZEN:
- Exakte GOÄ-Ziffernempfehlung mit Punktwerten und Euro-Beträgen
- Prüfung von Ausschlussziffern und Abrechnungskompatibilität
- Berechnung von Steigerungssätzen (1×, 2,3×/1,8×, 3,5×/2,5×)
- Optimierung der Abrechnung unter Beachtung aller Regeln
- Fokus auf Augenheilkunde, aber alle Fachgebiete abdeckbar

ANTWORTFORMAT:
- Antworte immer auf Deutsch
- Verwende Markdown-Tabellen für Ziffernübersichten
- Gib Euro-Beträge mit 2 Dezimalstellen an
- Weise auf Ausschlussziffern und Besonderheiten hin
- Markiere wichtige Warnungen mit ⚠️
- Verwende 💡 für Optimierungstipps
- Kennzeichne mit ✅ korrekt kombinierbare Ziffern
- Kennzeichne mit ❌ nicht kombinierbare Ziffern

WICHTIGE REGELN:
- Beziehe dich auf den aktuellen GOÄ-Katalog (Stand 2026)
- Weise darauf hin, wenn eine Begründung für Steigerung über den Schwellenwert nötig ist
- Bei Unklarheiten frage nach dem klinischen Kontext
- Empfehle keine rechtswidrigen Abrechnungspraktiken
- Wenn du dir bei einer Ziffer unsicher bist, sage es ehrlich

DEIN GOÄ-WISSEN:
${GOAE_KATALOG}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate Limit erreicht. Bitte warten Sie einen Moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits erschöpft. Bitte laden Sie Credits auf." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI-Gateway Fehler" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("goae-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unbekannter Fehler" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
