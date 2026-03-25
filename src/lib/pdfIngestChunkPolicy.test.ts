import { describe, expect, it } from "vitest";

/**
 * Spiegelt die Truncation-Logik aus admin-context-upload (ohne Deno).
 */
function chunkText(
  text: string,
  chunkSize: number,
  overlap: number,
  maxChunks: number,
): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  let start = 0;
  let lastEnd = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    lastEnd = end;
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  const truncated = lastEnd < text.length;
  return { chunks, truncated };
}

describe("pdf ingest chunk policy", () => {
  it("marks truncated when text continues after max chunks", () => {
    const big = "x".repeat(5000);
    const { chunks, truncated } = chunkText(big, 500, 50, 3);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(truncated).toBe(true);
  });

  it("not truncated when whole string fits", () => {
    const { chunks, truncated } = chunkText("a\nb\nc", 100, 10, 10);
    expect(truncated).toBe(false);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
