/**
 * E2E Blackbox-Runner (Spec: specs/01_DEV_LIFECYCLE.md §2.2).
 * Eigenständig; spricht HTTP gegen Base-URL (Mock oder Staging).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { createMockServer } from "./mock-server.ts";
import type { E2EReport, FixtureFile, FixtureResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getNested(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce((acc: unknown, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

async function runHttpFixture(
  baseUrl: string,
  fx: FixtureFile,
): Promise<{ ok: boolean; diff?: string; error?: string; duration_ms: number }> {
  const input = fx.input;
  const method =
    input.type === "http_post"
      ? "POST"
      : input.type === "http_get" || input.type === "pdf_upload"
        ? "GET"
        : "GET";
  const urlPath = input.path ?? "/";
  const url = `${baseUrl.replace(/\/$/, "")}${urlPath}`;
  const started = performance.now();

  try {
    const res = await fetch(url, {
      method,
      headers: input.headers ?? {},
      body: method === "POST" ? (input.body ?? "{}") : undefined,
    });
    const duration_ms = Math.round(performance.now() - started);
    const exp = fx.expected.output ?? {};
    const statusExpect = exp.status_code as number | undefined;
    if (statusExpect !== undefined && res.status !== statusExpect) {
      return {
        ok: false,
        diff: `status_code: expected ${statusExpect}, got ${res.status}`,
        duration_ms,
      };
    }

    const maxMs = exp.response_time_max_ms as number | undefined;
    if (maxMs !== undefined && duration_ms > maxMs) {
      return {
        ok: false,
        diff: `response_time: ${duration_ms}ms > max ${maxMs}ms`,
        duration_ms,
      };
    }

    const jsonPath = exp.json_path as Record<string, unknown> | undefined;
    if (jsonPath && res.headers.get("content-type")?.includes("json")) {
      const body = await res.json();
      for (const [k, v] of Object.entries(jsonPath)) {
        const actual = getNested(body, k);
        if (actual !== v) {
          return {
            ok: false,
            diff: `json_path ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`,
            duration_ms,
          };
        }
      }
    }

    return { ok: true, duration_ms };
  } catch (e) {
    return {
      ok: false,
      error: String(e),
      duration_ms: Math.round(performance.now() - started),
    };
  }
}

function validateRunnerMeta(report: E2EReport, fx: FixtureFile): { ok: boolean; diff?: string } {
  const want = fx.expected.output?.report_fields as string[] | undefined;
  if (!want) return { ok: true };
  for (const f of report.fixtures) {
    for (const field of want) {
      if (!(field in f)) {
        return { ok: false, diff: `missing field ${field} on ${f.fixture_id}` };
      }
    }
  }
  return { ok: true };
}

async function main(): Promise<void> {
  const useMock = process.env.E2E_USE_MOCK !== "0";
  let baseUrl = process.env.E2E_BASE_URL ?? "";
  let server: ReturnType<typeof createMockServer> | null = null;

  if (useMock && !baseUrl) {
    server = createMockServer();
    await new Promise<void>((resolve, reject) => {
      server!.listen(0, "127.0.0.1", () => resolve());
      server!.on("error", reject);
    });
    const addr = server.address();
    if (addr && typeof addr === "object") {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  }

  if (!baseUrl) {
    console.error("Set E2E_BASE_URL or use E2E_USE_MOCK (default).");
    process.exit(1);
  }

  const fixturesDir = path.join(__dirname, "../fixtures");
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const fixtures: FixtureFile[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(fixturesDir, file), "utf8");
    fixtures.push(YAML.parse(raw) as FixtureFile);
  }

  const ordered = [...fixtures].sort((a, b) => {
    if (a.input.type === "runner_meta") return 1;
    if (b.input.type === "runner_meta") return -1;
    return a.fixture_id.localeCompare(b.fixture_id);
  });

  const results: FixtureResult[] = [];
  let allPass = true;

  for (const fx of ordered) {
    if (fx.input.type === "runner_meta") {
      const reportSoFar: E2EReport = {
        cycle: 1,
        timestamp: new Date().toISOString(),
        fixtures: results,
        exit_code: 0,
      };
      const v = validateRunnerMeta(reportSoFar, fx);
      const duration_ms = 0;
      const fr: FixtureResult = {
        fixture_id: fx.fixture_id,
        status: v.ok ? "pass" : "fail",
        duration_ms,
        diff: v.diff,
      };
      results.push(fr);
      if (!v.ok) allPass = false;
      continue;
    }

    const started = performance.now();
    if (fx.input.type === "http_get" || fx.input.type === "http_post") {
      const r = await runHttpFixture(baseUrl, fx);
      const fr: FixtureResult = {
        fixture_id: fx.fixture_id,
        status: r.ok ? "pass" : "fail",
        duration_ms: r.duration_ms,
        diff: r.diff,
        error: r.error,
      };
      results.push(fr);
      if (!r.ok) allPass = false;
    } else {
      results.push({
        fixture_id: fx.fixture_id,
        status: "fail",
        duration_ms: Math.round(performance.now() - started),
        error: `unsupported input.type: ${fx.input.type}`,
      });
      allPass = false;
    }
  }

  const report: E2EReport = {
    cycle: 1,
    timestamp: new Date().toISOString(),
    fixtures: results,
    exit_code: allPass ? 0 : 1,
  };

  const outPath = process.env.E2E_REPORT_PATH ?? path.join(process.cwd(), "e2e-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`E2E report written to ${outPath}`);

  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
