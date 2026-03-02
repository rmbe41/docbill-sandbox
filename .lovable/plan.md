

## Problem

The AI model produces dense, hard-to-read output despite the system prompt containing formatting instructions. Two root causes:

1. **System Prompt**: The formatting instructions are buried among other rules and not forceful enough — the model often ignores them
2. **CSS Rendering**: While prose classes exist, key visual separators (horizontal rules, section headers, spacing) aren't prominent enough

## Plan

### 1. Rewrite System Prompt formatting section (Edge Function)

Make formatting instructions **the first and most prominent** section of the prompt, with explicit examples and hard constraints:

- Move formatting rules to the TOP of the prompt (before domain knowledge)
- Add explicit "NEVER output more than 3 sentences without a visual break" rule
- Require `---` separators between every section
- Require bullet points for any list of 2+ items
- Require tables for any data with 3+ columns
- Add a compact example output template the model must follow
- Add a closing reinforcement: "FORMATTING IS MANDATORY — unstructured walls of text are unacceptable"

### 2. Enhance CSS rendering for visual clarity

Strengthen the visual weight of markdown elements in `ChatBubble.tsx` and `index.css`:

- **Horizontal rules**: Thicker, more visible, with generous vertical margins (1.5rem+)
- **H2 headers**: Larger font, colored left-border accent bar, more top-margin to create clear sections
- **H3 headers**: Distinct styling from body text
- **Tables**: Alternating row colors for readability
- **Bullet lists**: Custom markers, indentation
- **Blockquotes/warnings**: Colored background panels for ⚠️/💡/✅ blocks
- **Section cards**: Wrap major sections in subtle bordered containers

### 3. Add emoji-header detection for styled section blocks

In `ChatBubble.tsx`, add custom renderers for `ReactMarkdown` that detect section headers starting with emojis (📋, ✅, ⚠️, 💡, 📝) and render them as color-coded card-like containers:

- 📋 → neutral/blue card header
- ✅ → green-tinted section
- ⚠️ → amber/yellow-tinted section  
- 💡 → accent/teal-tinted section
- 📝 → neutral summary section

This uses ReactMarkdown's `components` prop to override `h2` and `hr` rendering.

### Files to modify

- `supabase/functions/goae-chat/index.ts` — restructure SYSTEM_PROMPT
- `src/components/ChatBubble.tsx` — add custom ReactMarkdown renderers + enhanced prose classes
- `src/index.css` — stronger visual separator styles

