# m07-options-color-ui Progress

## Goal
Polish the Options page color pickers and appearance preview.

## Tasks

### Task 1: Bilingual color labels
- Add English labels to all color options (word/sentence underline, floating ball, full translate colors)
- Match the format already used in word/sentence underline color pickers

### Task 2: Appearance preview – underline/annotation
- Add word/phrase text with real underline rendering to the preview panels
- Reference actual content script rendering code (not just CSS text-decoration)

## Status
- [ ] Task 1: Bilingual color labels
- [x] Task 2: Appearance preview underline
  - Added `.ap-underline-demo` rows (word + phrase) to both light/dark ap-stage panels
  - CSS replicates real `border-top` underline from `.ai-translator-tooltip` in content script
  - `updateAppearancePreview()` reads `wordUnderlineColorV2` / `sentenceUnderlineColor` and applies colors with opacity
