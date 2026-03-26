import { describe, expect, it } from "vitest";
import {
  buildSelectiveCatalogMarkdown,
  goaeByZiffer,
} from "../../supabase/functions/goae-chat/goae-catalog-json.ts";

describe("buildSelectiveCatalogMarkdown priorityZiffern", () => {
  it("always includes priority Ziffern before filler cap", () => {
    const ziffern = new Set<string>();
    for (let i = 1; i <= 80; i++) {
      const z = String(i);
      if (goaeByZiffer.has(z)) ziffern.add(z);
    }
    if (goaeByZiffer.has("1256")) ziffern.add("1256");

    const md = buildSelectiveCatalogMarkdown({
      ziffern,
      maxLines: 5,
      subtitle: "## Testauszug",
      priorityZiffern: new Set(["1256"]),
    });

    expect(md).toMatch(/1256\|/);
    const firstDataLine = md.split("\n").find((l) => l.includes("1256|"));
    expect(firstDataLine).toBeDefined();
    const linesBefore1256 = md.split("\n").findIndex((l) => l.includes("1256|"));
    const line1 = md.split("\n").findIndex((l) => l.startsWith("1|"));
    expect(linesBefore1256).toBeLessThan(line1 >= 0 ? line1 : 99999);
  });
});
