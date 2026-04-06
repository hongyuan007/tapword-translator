# Handoff: V2 Translation Display — UI Tweaking

## Current Work Context

We are working on the **V2 Range-based translation display system** for a Chrome browser extension (translation tool). The V2 system replaces the old V1 approach (which wrapped translated text in `<span>` DOM elements) with a **non-intrusive Range-based** approach — translations are tracked via `Range` objects and tooltips are absolutely-positioned `<div>` elements, without modifying the page DOM.

### Branch & Version
- Version: **0.4.2** (`version_name: "0.4.2-tooltipv2"`)
- This is a feature branch focused on V2 tooltip system improvements

### What Has Been Done
All functional bugs have been resolved:
- 3-zone hit testing (click detection for translated text, tooltip, and gap between them)
- Two-layer overlap detection (prevents duplicate translations on same text)
- Selection validation (endpoint-based containment checking)
- Click vs drag-select disambiguation
- Double-click removal of translations
- Tooltip width matches source text, text is centered
- Line-height scoping fix
- Orphan detection for React SPA DOM updates (tested on Twitter)

### What's Next: UI Tweaks
The next phase is **visual/UI micro-adjustments** to the tooltip display. The user will guide specific changes during the session.

---

## Key Files

### Core V2 System
| File | Purpose | Lines |
|------|---------|-------|
| `src/1_content/ui/translationDisplayV2.ts` | **Main coordinator** — tooltip creation, positioning, orphan detection, cleanup | ~670 |
| `src/1_content/ui/translationDisplayV2/hitTesting.ts` | Click/dblclick handlers, `isPointInsideTranslationZone()` | ~200 |
| `src/1_content/ui/translationDisplayV2/types.ts` | Shared types, constants (`CLICK_DEBOUNCE_DELAY_MS`, `RANGE_HIT_TEST_HORIZONTAL_PAD_PX`) | ~60 |

### Styling
| File | Purpose |
|------|---------|
| `src/1_content/resources/content.css` | CSS for `.ai-translator-tooltip` and related classes |

### Supporting Files
| File | Purpose |
|------|---------|
| `src/1_content/handlers/utils/selectionValidator.ts` | Selection validation before triggering translation |
| `src/1_content/handlers/utils/translationOverlapDetectorV2.ts` | Overlap detection for V2 ranges |
| `src/1_content/handlers/TranslationPipeline.ts` | Orchestrates the translation flow |
| `src/1_content/utils/lineHeightAdjuster.ts` | Adjusts line-height on block ancestors |

### Documentation
| File | Purpose |
|------|---------|
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/PROGRESS.md` | Task progress tracker |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/README.md` | Original bug description & root cause |
| `src/1_content/README.md` | Content module architecture |

---

## Key Architecture Concepts

### Tooltip Structure
Each translation creates:
1. A **Range** object pointing to the original text (no DOM modification)
2. One or more **tooltip `<div>` elements** (class `.ai-translator-tooltip`) positioned absolutely below the text
3. Tooltips have a **blue top border** acting as an underline for the source text

### Tooltip Positioning (`positionTooltip()` in translationDisplayV2.ts)
- Uses `range.getClientRects()` to get the bounding boxes of translated text
- Positions tooltips below each line of text
- On scroll/resize, recalculates positions
- If `range.startContainer.isConnected === false`, the tooltip is treated as orphaned and removed

### CSS Classes
- `.ai-translator-tooltip` — The tooltip container (positioned absolutely)
- `.ai-translator-tooltip-text` — The translated text inside the tooltip
- Tooltip styles are defined in `content.css` and also set inline in `positionTooltip()`

### How Translations Are Stored
```typescript
// In translationDisplayV2.ts
const activeTranslations = new Map<string, TranslationEntry>();

interface TranslationEntry {
  range: Range;           // Points to original text
  tooltips: HTMLElement[]; // Tooltip DOM elements
  result: TranslationResult;
  // ... other fields
}
```

---

## Build & Test Commands
- `npm run dev` — Development build with watch mode (output to `dist/`)
- `npm run build` — Production build
- `npm run type-check` — TypeScript type checking (run after code changes)
- Load `dist/` folder as unpacked extension in Chrome

## Project Conventions
- Use `@/` prefix for imports (maps to `src/`)
- Use namespace imports: `import * as module from '@/...'`
- Use `createLogger()` instead of `console.log`
- Read module README before modifying code
