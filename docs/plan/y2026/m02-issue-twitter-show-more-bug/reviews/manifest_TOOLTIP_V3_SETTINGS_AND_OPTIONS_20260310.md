# File Save Path
`/Users/hongyuan/project/v3/tapword-translator/docs/plan/y2026/m02-issue-twitter-show-more-bug/reviews/manifest_TOOLTIP_V3_SETTINGS_AND_OPTIONS_20260310.md`

### 1. Change Context
- **Related Documents**:
  - `docs/plan/y2026/m02-issue-twitter-show-more-bug/handoff-prompt.md`
  - `docs/plan/y2026/m02-issue-twitter-show-more-bug/README.md`
  - `docs/plan/y2026/m02-issue-twitter-show-more-bug/SOLUTION_F_ANALYSIS.md`
  - `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/v1版本下划线位置.png`
  - `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/v2版本下划线位置.png`
- **Task Objectives**:
  - Adjust the V2 Range-based tooltip UI intending to restore independently configurable vertical spacing controls for underline position, translation-to-underline spacing, and blank space below the translation text.
  - Modify the options page intending to expose those controls as slider-based settings with a live preview instead of raw number inputs.
  - Adjust the preview and runtime logic intending to keep stored values user-facing while applying an internal underline offset shift only at render time.

### 2. File Change Audit
| File Path | Change Type | Objective Description |
| :--- | :--- | :--- |
| `src/0_common/types/index.ts` | Mod | Added new V3 tooltip spacing settings and adjusted defaults for underline offset, translation offset, and bottom spacing. |
| `src/0_common/utils/storageManager.ts` | Mod | Normalized persisted settings so the new V3 tooltip spacing values are loaded from storage or defaulted without altering the raw stored values. |
| `src/0_common/locales/zh.json` | Mod | Added and revised user-facing labels/helpers for the new tooltip spacing controls and slider-related wording. |
| `src/0_common/locales/en.json` | Mod | Added and revised English labels/helpers for the new tooltip spacing controls and slider-related wording. |
| `src/1_content/index.ts` | Mod | Modified dynamic content-script style application so the V3 underline setting is translated into an effective runtime offset with an internal negative shift. |
| `src/1_content/resources/content.css` | Mod | Adjusted tooltip styling to support the separated tooltip content container used by the V2 layout changes. |
| `src/1_content/ui/translationDisplayV2.ts` | Mod | Modified V2 tooltip positioning and per-line layout so underline spacing, translation spacing, and bottom spacing are driven by separate V3 settings during render. |
| `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` | Mod | Added a dedicated tooltip content wrapper and helper methods so underline and translation content can be offset independently. |
| `src/1_content/utils/styleCalculator/layout.ts` | Mod | Modified tooltip font/space calculations so the new V3 spacing settings, including the effective underline shift, influence available space and font sizing. |
| `src/1_content/utils/lineHeightAdjuster.ts` | Mod | Adjusted line-height increase calculations so the new V3 translation spacing and bottom spacing settings affect reserved vertical space. |
| `src/4_options/index.html` | Mod | Reworked the options UI from numeric inputs to slider controls with live value pills and an updated preview structure for the tooltip spacing settings. |
| `src/4_options/index.ts` | Mod | Modified the options-page preview logic so slider values, preview tooltip width, centered preview text, and effective underline offset mapping are reflected visually. |
| `src/4_options/modules/settingsManager.ts` | Mod | Updated settings loading/saving logic so range inputs are hydrated from stored settings and saved as bounded numeric values. |
| `src/4_options/styles.css` | Mod | Restyled the spacing controls and preview tooltip to match the new slider-based settings UI and the updated preview layout model. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/v1版本下划线位置.png` | Add | Added screenshot reference for the older tooltip underline/translation spacing behavior used as a visual target. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/v2版本下划线位置.png` | Add | Added screenshot reference for the newer tooltip underline/translation spacing behavior used for comparison. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/1.选择三行文本.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/2.翻译中.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/3.翻页结果.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/有问题.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/点击红框中的单词触发上面翻译tooltip弹窗.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |
| `docs/plan/y2026/m02-issue-twitter-show-more-bug/临时图片/预期状态.png` | Del | Removed a previously staged screenshot no longer kept in the current staged set. |

### 3. AI Generation Disclaimer & Risk Warnings (AI Disclaimer)
> **Important Note for Reviewer**:
> The code in this submission was generated by an AI assistant based on documentation, screenshots, and iterative UI adjustments. **Do not assume the code logic is correct.**

You need to prioritize reviewing the following potential risk points:
- [ ] **Logical Consistency**: Verify the new V3 settings semantics actually match the intended user-visible behavior: `原文离下划线距离`, `译文离下划线距离`, and `译文下方留白` should remain distinct controls rather than overlapping effects.
- [ ] **Storage vs Render Semantics**: Confirm the raw user setting is what gets stored, while the internal `-2px` underline shift is applied only at runtime/preview consumption points and not accidentally persisted or double-applied.
- [ ] **Options Initialization**: Re-check options-page initialization and hydration for `input[type="range"]`; the staged bugfix attempts to address sliders defaulting to midpoint values instead of loaded settings.
- [ ] **Preview Fidelity**: Verify the options preview faithfully reflects runtime tooltip behavior, especially underline width matching the source text width, preview text centering, and vertical spacing changes.
- [ ] **Side Effects**: Check whether the new content wrapper or offset logic affects truncation, spinner loading state, multiline segmentation, or tooltip alignment in existing V2 flows.
- [ ] **Line-Height Calculations**: Review whether the new V3 spacing parameters interact correctly with `styleCalculator` and `lineHeightAdjuster`, particularly for headings, narrow lines, and low line-height content.
- [ ] **Edge Cases**: Test values at slider extremes (`0`, `20`), verify effective negative underline offset behavior near `0`, and confirm multi-line, single-line, loading, error, and fragment tooltip variants remain usable.
- [ ] **Localization / UX Copy**: Check that the revised control names and helper text are clear for ordinary users and still accurate in both Chinese and English.
