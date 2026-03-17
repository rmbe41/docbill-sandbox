/**
 * Fetch mit Timeout – verhindert endloses Hängen bei langsamen/hängenden APIs.
 * Nach Ablauf wird der Request abgebrochen und ein Fehler geworfen.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 90000, ...fetchInit } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeoutId);
  }
}
