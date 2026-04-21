export interface FixtureInput {
  type: string;
  path?: string;
  file?: string;
  user_role?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FixtureExpected {
  parsing?: Record<string, unknown>;
  analyse?: Record<string, unknown>;
  output?: Record<string, unknown>;
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
