

## Problem

The assistant's table output is constrained to `max-w-[75%]` of the chat bubble. With 7 columns (Nr., GOÄ, Bezeichnung, Faktor, Betrag, Status, Anmerkung), the table gets cramped and hard to read. The user wants:

1. **Wider table display** — tables should break out of the narrow bubble width
2. **Horizontal scroll** when content overflows
3. **Frozen/sticky first columns** (the original invoice data: Nr., GOÄ, Bezeichnung) so they stay visible while scrolling to see Status/Anmerkung

## Plan

### 1. Widen assistant bubble for table content

In `ChatBubble.tsx`, change the assistant bubble's `max-w-[75%]` to `max-w-[90%]` so tables have more room. User bubbles stay at 75%.

### 2. Add custom table renderer with horizontal scroll + sticky columns

In `ChatBubble.tsx`, add a custom `table` component to `markdownComponents` that:
- Wraps the table in a horizontally scrollable container (`overflow-x-auto`)
- Applies `position: sticky; left: 0` to the first 3 columns (Nr., GOÄ, Bezeichnung) with a background color so they don't become transparent when scrolling

### 3. CSS for sticky columns

In `index.css`, add styles:
- `.markdown-output table td:nth-child(-n+3)` and `th:nth-child(-n+3)` get `position: sticky` with calculated `left` offsets
- Background color matching the row (including zebra-stripe) so sticky cells cover content beneath
- A subtle right border/shadow on the 3rd column to indicate the freeze boundary
- `white-space: nowrap` on the first 3 columns to prevent wrapping, `min-width` values for consistent column sizing

### Files to modify

- `src/components/ChatBubble.tsx` — widen assistant bubble, add custom table wrapper component
- `src/index.css` — sticky column styles, scroll container styles

