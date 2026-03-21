# Floating Button Icon Variants — Implementation Spec

## Summary
Add 6 selectable icon variants for the floating button, with UI in the options page to choose between them. Follow Gemini's design spec exactly.

## Design Spec (from Gemini)

### Pill Container
- Width: 60px, Height: 40px
- Left-rounded pill: `border-radius: 9999px 0 0 9999px`
- White background `#ffffff`, shadow `0 4px 12px rgba(0,0,0,0.08)`
- Border: `1px solid #e5e7eb`, no right border
- Idle: opacity 0.6, translateX(15px)

### Inner Icon
- SVG rendered at 26×26px
- Positioned with `padding-left: 8px` inside pill
- Brand pink: `#ED6D8F`
- Internal scale: `scale(0.923)` for breathing room

### Badges/Spinner
- Position: `bottom: 4px; left: 26px` (overhang at right edge of inner circle)
- Active badge: 12×12 green circle with white check
- Spinner: 12×12 blue rotating ring

### Close Button  
- 16×16px at `top: -5px; left: -5px`

## 6 Icon Variants (SVG)

### V1 — Classic Brand (tilted thin T on pink circle)
### V2 — Gradient Quality (gradient pink, shadow on T)
### V3 — Brand Circle (upright T on pink circle)
### V4 — Minimal Brand T (no background, pink T only)
### V5 — AI Sparkle (pink T + stars)
### V6 — Brand Diagonal Combo (frame + star + T)

SVGs are defined in `icon-preview-full.html`.

## Implementation Plan

### 1. Types — `src/12_floating_button/types.ts`
Add `iconVariant` field to `FloatingButtonConfig`:
```typescript
export type IconVariant = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6'
```
Add to `FloatingButtonConfig`:
```typescript
iconVariant: IconVariant
```

### 2. Constants — `src/12_floating_button/constants.ts`
- Default iconVariant: `'v1'`
- Update dimensions: BUTTON_WIDTH_PX=60, BUTTON_HEIGHT_PX=40, IDLE_TRANSLATE_X_PX=15

### 3. Icon SVGs — new file `src/12_floating_button/ui/iconVariants.ts`
Export a `Record<IconVariant, string>` mapping each variant to its SVG string.

### 4. Styles — `src/12_floating_button/ui/styles.ts`
Update to match Gemini's pill design:
- Restore white bg, border, box-shadow on main button
- Icon: 26×26px, padding-left 8px, border-radius: 50%
- Badge/spinner position: bottom:4px, left:26px

### 5. Renderer — `src/12_floating_button/ui/FloatingButtonRenderer.ts`
- Import icon variants map
- Accept `iconVariant` in `create()` method
- Use selected variant's SVG

### 6. Manager — `src/12_floating_button/FloatingButtonManager.ts`
- Pass `iconVariant` from config to renderer

### 7. Options Page — `src/4_options/`
- Add "Floating Button Appearance" section in index.html (Appearance section)
- Show 6 thumbnails in a grid, highlight selected one
- Load/save `iconVariant` via chrome.storage.local
- Add CSS for icon picker grid
- Add i18n keys for labels

### 8. Locales
- Add translation keys for the icon picker label in all locale files
