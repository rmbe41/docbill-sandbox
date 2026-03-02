

## Problem

The 💡 Optimierungspotenzial table inherits the same sticky-column CSS and min-widths designed for the 7-column main table. This causes the middle columns to be unnecessarily wide while the last column ("Zusätzlich" or description text) gets compressed.

## Solution

Two changes:

### 1. Restructure the prompt table format (`supabase/functions/goae-chat/index.ts`)

Change the Optimierungspotenzial table from 4 columns to 3 compact columns, merging GOÄ+Faktor into one and making the description the primary wide column:

```
| GOÄ | Beschreibung | Potenzial |
|-----|-------------|-----------|
| **1202** 2,3× | Refraktionsbestimmung – empfohlen bei [klinischer Kontext] | +9,92€ |
```

This puts the dense info (code + factor) in column 1, gives the description maximum space in column 2, and keeps the monetary value compact in column 3.

### 2. CSS: Remove sticky behavior for smaller tables (`src/index.css`)

The sticky column rules (with fixed `min-width` and `left` offsets) should only apply to tables with more than 4 columns. Add a CSS override so tables inside the optimization section don't get the sticky treatment, or use `:has()` / a wrapper class approach to scope sticky behavior to wide tables only.

