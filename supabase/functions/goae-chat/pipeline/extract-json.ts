/** Extrahiert JSON aus LLM-Response-Strings (ohne Abhängigkeit von callLlm — z. B. für NER). */

function sanitizeForJson(s: string): string {
  let out = s
    .replace(/^\uFEFF/, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .trim();
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return out;
}

function findMatchingBrace(str: string, start: number): number {
  const open = str[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = '"';
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

export function extractJson<T>(raw: string): T {
  if (!raw || typeof raw !== "string") {
    throw new Error(
      "Konnte kein gültiges JSON extrahieren: LLM-Antwort war leer oder ungültig.",
    );
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Konnte kein gültiges JSON extrahieren: LLM-Antwort war leer.");
  }

  let result = tryParse<T>(trimmed);
  if (result !== null) return result;

  const sanitized = sanitizeForJson(trimmed);
  result = tryParse<T>(sanitized);
  if (result !== null) return result;

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    const block = sanitizeForJson(jsonBlockMatch[1]);
    result = tryParse<T>(block);
    if (result !== null) return result;
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = findMatchingBrace(trimmed, firstBrace);
    if (lastBrace !== -1) {
      const slice = sanitizeForJson(trimmed.slice(firstBrace, lastBrace + 1));
      result = tryParse<T>(slice);
      if (result !== null) return result;
    }
  }

  const firstBracket = trimmed.indexOf("[");
  if (firstBracket !== -1) {
    const lastBracket = findMatchingBrace(trimmed, firstBracket);
    if (lastBracket !== -1) {
      const slice = sanitizeForJson(trimmed.slice(firstBracket, lastBracket + 1));
      result = tryParse<T>(slice);
      if (result !== null) return result;
    }
  }

  const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
  throw new Error(
    `Konnte kein gültiges JSON aus der LLM-Antwort extrahieren. Vorschau: "${preview.replace(/\n/g, " ")}"`,
  );
}
