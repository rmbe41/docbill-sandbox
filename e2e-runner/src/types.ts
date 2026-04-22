export interface FixtureInput {
  type: string;
  path?: string;
  file?: string;
  user_role?: string;
  headers?: Record<string, string>;
  /** JSON string or object (object is stringified). */
  body?: string | Record<string, unknown>;
}

export interface FixtureExpected {
  /**
   * Stabiles JSON-Fragment aus `docbill_parsing` (SSE) oder API-JSON.
   * Unterstützt u.a.: positionen_count, ziffern (exakte Reihenfolge).
   */
  parsing?: Record<string, unknown>;
  /**
   * Felder aus `docbill_analyse` im SSE-Stream.
   * Unterstützt u.a.: kategorien_count, disclaimer_contains.
   */
  analyse?: Record<string, unknown>;
  output?: {
    status_code?: number;
    response_time_max_ms?: number;
    json_path?: Record<string, unknown>;
    report_fields?: string[];
    diff_optional?: boolean;
    /** For SSE / non-JSON: every substring must appear in the response body text. */
    text_contains?: string[];
    [key: string]: unknown;
  };
  no_pii_in_llm_request?: boolean;
}

export interface FixtureFile {
  fixture_id: string;
  name: string;
  input: FixtureInput;
  expected: FixtureExpected;
}

export interface FixtureResult {
  fixture_id: string;
  status: "pass" | "fail";
  duration_ms: number;
  diff?: string;
  error?: string;
}

export interface E2EReport {
  cycle: number;
  timestamp: string;
  fixtures: FixtureResult[];
  exit_code: number;
}
