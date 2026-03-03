# Issue #14: Dark Mode Adaptation Issue - Progress Tracker

## 1. Issue Summary
User reported that the translation tooltip text is illegible (black) on dark mode websites (specifically Nuxt documentation).
- **Issue**: [Github Issue #14](https://github.com/hongyuan007/tapword-translator/issues/14)
- **Problem**: Extension calculates tooltip text color based only on foreground text brightness. When text is a mid-tone color (like Nuxt Green `#00DC82`, brightness ~144) on a dark background (`#020420`), the extension incorrectly defaults to black text, which is invisible.

## 2. Reproduction Status
- **Local Reproduction**: ✅ SUCCESS
  - Created `tests/html/issue-14-dark-mode.html` mimicking Nuxt color scheme.
  - Confirmed `Tooltip computed color: rgb(0, 0, 0)` on dark background.
  - Test Spec: `tests/e2e/specs/issue-14-dark-mode.spec.ts` (first test).

- **Live Site Reproduction**: ✅ SUCCESS
  - Target: `https://nuxt.com/docs/4.x/getting-started/introduction`
  - Element: Link text "intuitive" (mid-tone green/blue).
  - Confirmed `Tooltip computed color on live site: rgb(0, 0, 0)`.
  - Artifacts:
    - `tests/e2e/screenshots/issue-14-live-context-clip.png` (Best proof)
    - `tests/e2e/screenshots/issue-14-live-reproduction.png`

## 3. Root Cause Analysis
The file `src/1_content/utils/styleCalculator.ts` contains `getHighContrastColor` which only checks the text color's brightness:
```typescript
const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000
return brightness < 150 ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)"
```
It fails to consider the **background color** of the element or its containers.

## 4. Fix Plan (Next Steps)
1.  **Implement `getEffectiveBackgroundColor`**:
    - Add a helper in `styleCalculator.ts` to traverse up the DOM from the target element.
    - Find the first non-transparent background color.
    - Default to white if none found (root).

2.  **Update `calculateTooltipStyle`**:
    - Use the effective background color to determine the primary contrast requirement.
    - Logic:
        - If background is Dark (brightness < 128) -> Force White Text.
        - If background is Light (brightness >= 128) -> Force Black Text.
    - This should take precedence over the text-color heuristic.

3.  **Verification**:
    - Run `npm run test:e2e:headed -- tests/e2e/specs/issue-14-dark-mode.spec.ts`
    - Verify both local and live tests pass (tooltip should become white/visible).

## 5. Artifacts & References
- **Test Spec**: `tests/e2e/specs/issue-14-dark-mode.spec.ts`
- **Screenshots**: `tests/e2e/screenshots/`
- **E2E Guide Updated**: `docs/skills/e2e-testing/SKILL.md` (Added tips on timeouts and screenshot reliability).
