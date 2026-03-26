import { describe, expect, it } from "vitest";
import { inferWelcomeStickyWorkflow } from "../../supabase/functions/goae-chat/infer-welcome-sticky.ts";

describe("inferWelcomeStickyWorkflow", () => {
  it("liefert null bei nur einem User-Turn", () => {
    expect(
      inferWelcomeStickyWorkflow([{ role: "user", content: "Leistungen abrechnen" }]),
    ).toBeNull();
  });

  it("erkennt Leistungen-Follow-up nach Welcome-Button", () => {
    const msgs = [
      { role: "user", content: "Leistungen abrechnen" },
      { role: "assistant", content: "Bitte nennen Sie die Leistungen." },
      { role: "user", content: "OCT, Fundus, Visus" },
    ];
    expect(inferWelcomeStickyWorkflow(msgs)).toBe("leistungen_abrechnen");
  });

  it("erkennt Rechnung-prüfen-Follow-up", () => {
    const msgs = [
      { role: "user", content: "Rechnung prüfen" },
      { role: "assistant", content: "Bitte laden Sie die Rechnung hoch." },
      { role: "user", content: "Anbei" },
    ];
    expect(inferWelcomeStickyWorkflow(msgs)).toBe("rechnung_pruefen");
  });

  it("erkennt Frage-Öffner-Follow-up", () => {
    const msgs = [
      { role: "user", content: "Ich möchte eine Frage stellen." },
      { role: "assistant", content: "Was möchten Sie wissen?" },
      { role: "user", content: "Was bedeutet GOÄ 401?" },
    ];
    expect(inferWelcomeStickyWorkflow(msgs)).toBe("frage");
  });
});
