

## Problem

When the AI identifies issues (e.g., "factor above threshold, justification needed" or "justification too generic"), it only states the problem but doesn't provide a **concrete, copy-paste-ready suggestion** for how to fix it. Users need actionable text they can directly use.

## Plan

### Add "KONKRETE VORSCHLÄGE" rule to the system prompt

In `supabase/functions/goae-chat/index.ts`, add a new mandatory rule section to `FORMATTING_RULES` and update the table example:

1. **New rule in HARTE REGELN**: Add a rule that every ⚠️ or ❌ annotation MUST include a concrete suggestion — not just describe the problem
2. **New "Vorschlag" column** in the main table (or expand "Anmerkung" to include a suggestion line), e.g.:

```
| 3 | 5 | Beratung | 3,0× | 30,60€ | ⚠️ | Über Schwellenwert → **Vorschlag:** „Aufgrund der überdurchschnittlichen Komplexität bei [Diagnose] und erhöhtem Zeitaufwand von ca. XX Min. ist ein Faktor von 3,0× gerechtfertigt." |
```

3. **Add explicit instruction block** in SYSTEM_PROMPT explaining:
   - For factor issues: provide a specific justification text template with placeholders
   - For exclusion conflicts: suggest which code to keep/remove and why
   - For missing codes: suggest the exact code with expected amount
   - For generic justifications: rewrite the justification concretely

### Files to modify

- `supabase/functions/goae-chat/index.ts` — add concrete-suggestion rules to prompt + update table example

