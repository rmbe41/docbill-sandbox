/** Sandbox-Daten speichern ISO-Datum (yyyy-mm-dd); Anzeige/Eingabe europäisch dd/mm/yyyy. */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const EURO_DAY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

export function formatSandboxDateEuropean(
  value: string | null | undefined,
  opts?: { emptyLabel?: string },
): string {
  const empty = opts?.emptyLabel ?? "—";
  if (value == null || !String(value).trim()) return empty;
  const m = String(value).trim().match(ISO_DAY);
  if (!m) return String(value).trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Akzeptiert yyyy-mm-dd oder dd/mm/yyyy (auch mit `.` als Trenner). */
export function parseSandboxDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(ISO_DAY);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = s.match(EURO_DAY);
  if (!eu) return null;
  const d = parseInt(eu[1]!, 10);
  const month = parseInt(eu[2]!, 10);
  const y = parseInt(eu[3]!, 10);
  if (month < 1 || month > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, month - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
