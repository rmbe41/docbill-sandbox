

## Plan: Decrease Floating Island Size by ~30%

### Change: `src/components/ChatInput.tsx`

Reduce the padding, font sizes, button sizes, and internal spacing of the floating island:

- Outer padding: `px-4 py-3` → `px-3 py-2`
- Textarea font: `text-sm` → `text-xs`, min-height `40px` → `32px`
- Send button: `h-10 w-10` → `h-8 w-8`, icon `w-4 h-4` → `w-3.5 h-3.5`
- Paperclip icon: `w-5 h-5` → `w-4 h-4`, padding `p-2` → `p-1.5`
- File chips: `text-sm px-2.5 py-1` → `text-xs px-2 py-0.5`
- Footer hint text: `text-[11px]` → `text-[9px]`, margin `mt-2` → `mt-1.5`
- Halo blur spread: reduce slightly

### Change: `src/pages/Index.tsx`

- Bottom padding on input container: `pb-5` → `pb-4`

