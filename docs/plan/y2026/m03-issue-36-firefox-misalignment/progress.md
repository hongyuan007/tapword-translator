# Issue #36: Firefox Text Misalignment Fix — Progress

## Phase 2: Implementation ✅ Complete

### Summary
Changed icon and tooltip positioning from `position: absolute` (with scroll offset calculation) to `position: fixed` (using viewport coords directly). This eliminates the Firefox misalignment caused by different `clientRect` calculations on pages with CSS `transform`/`filter`/`will-change` ancestors.

### Files Changed
| File | Change |
|---|---|
| `src/1_content/resources/content.css` | `.ai-translator-icon`: `position: absolute` → `position: fixed` |
| `src/1_content/resources/content.css` | `.ai-translator-tooltip`: `position: absolute` → `position: fixed` |
| `src/1_content/ui/iconManager.ts` | Removed `scrollOffset` (scrollX/scrollY/body.scrollTop) calculation; icon now uses `rect.bottom + 4` / `rect.right + 4` directly |
| `src/1_content/ui/translationDisplayV2.ts` | Removed `scrollOffset` calculation; tooltip uses `rect.bottom/left` directly for positioning; changed inline `style.position = "absolute"` → `"fixed"` |

### Scroll Behavior
The existing `scroll` event listener (`scheduleReposition`) already calls `positionTooltip()` on scroll, so tooltips will reposition correctly when the user scrolls. No additional scroll handling was needed.

### Type-Check Result
✅ All modified files pass type-check. One pre-existing error in unrelated file (`ServiceInitializer.ts`) remains unchanged.

### Not Modified (by design)
- `translationModal.ts` — already uses `position: fixed`, works correctly
- Viewport clamping logic — preserved as-is (now uses viewport coords without scroll offset)
- Hide/close logic — unaffected by position change
