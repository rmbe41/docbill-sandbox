/**
 * Code-Review-Agent (Spec: specs/01_DEV_LIFECYCLE.md §2.4).
 * Output: CodeReviewReport JSON auf stdout.
 *
 * Ohne OPENROUTER_API_KEY: summary.pass === true (info-only), damit CI ohne Secrets grün bleibt.
 */
import { spawnSync } from "node:child_process";

const CYCLE = 1;

interface Finding {
  severity: "critical" | "warning" | "info";
  rule: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

interface CodeReviewReport {
  cycle: number;
  timestamp: string;
  files_reviewed: number;
  findings: Finding[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    pass: boolean;
  };
}

const STANDARDS_PROMPT = `Du bist Review-Agent für DocBill. Prüfe den Git-Diff gegen:

DocBill-Regeln:
1. Keine hartcodierten GOÄ-/EBM-Ziffern im Code – nur aus JSON-Datenbasis.
2. Jeder LLM-Prompt in eigener, versionierter Prompt-Datei.
3. Pseudonymisierung nicht in Controller-/Route-Dateien.
4. API-Routen: Input-Validation (zod).
5. Keine console.log in Production – strukturiertes Logging.
6. Nutzer-Fehlermeldungen in zentraler i18n-Datei.
7. Keine Patientendaten in Logs – PII-Filter.
8. DB-Zugriffe über Repository-Pattern.

Weitere Prüfung: Architektur, Sicherheit, PII-Leak in Logs/Responses.

Antworte NUR mit gültigem JSON (kein Markdown) in exakt diesem Schema:
{
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "rule": "string",
      "file": "string",
      "line": number,
      "message": "string",
      "suggestion": "optional string"
    }
  ],
  "files_reviewed": number
}

line ist best effort (Zeile im Diff-Kontext).`;

function getDiff(): string {
  const base = process.env.REVIEW_BASE_REF ?? "HEAD~1";
  const r = spawnSync("git", ["diff", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error) {
    const r2 = spawnSync("git", ["diff"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return r2.stdout || "";
  }
  return r.stdout || "";
}

async function callOpenRouter(diff: string): Promise<CodeReviewReport> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return {
      cycle: CYCLE,
      timestamp: new Date().toISOString(),
      files_reviewed: 0,
      findings: [
        {
          severity: "info",
          rule: "review_agent_skip",
          file: "-",
          line: 0,
          message:
            "OPENROUTER_API_KEY nicht gesetzt — Review-Agent übersprungen (CI ohne Secrets).",
        },
      ],
      summary: { critical: 0, warning: 0, info: 1, pass: true },
    };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docbill.local",
      "X-Title": "DocBill Review Agent",
    },
    body: JSON.stringify({
      model: process.env.REVIEW_AGENT_MODEL ?? "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: STANDARDS_PROMPT },
        {
          role: "user",
          content: `Git-Diff:\n\n${diff.slice(0, 120_000)}`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as {
    findings?: Finding[];
    files_reviewed?: number;
  };

  const findings = (parsed.findings ?? []).map((f) => ({
    ...f,
    line: typeof f.line === "number" ? f.line : 0,
  }));
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;

  return {
    cycle: CYCLE,
    timestamp: new Date().toISOString(),
    files_reviewed: parsed.files_reviewed ?? 0,
    findings,
    summary: {
      critical,
      warning,
      info,
      pass: critical === 0,
    },
  };
}

async function main(): Promise<void> {
  const diff = getDiff();
  if (!diff.trim()) {
    const report: CodeReviewReport = {
      cycle: CYCLE,
      timestamp: new Date().toISOString(),
      files_reviewed: 0,
      findings: [
        {
          severity: "info",
          rule: "empty_diff",
          file: "-",
          line: 0,
          message: "Kein Git-Diff gefunden — nichts zu prüfen.",
        },
      ],
      summary: { critical: 0, warning: 0, info: 1, pass: true },
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const report = await callOpenRouter(diff);
  console.log(JSON.stringify(report, null, 2));
  if (!report.summary.pass) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
