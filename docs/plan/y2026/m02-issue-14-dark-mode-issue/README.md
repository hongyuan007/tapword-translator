# Issue 14: Dark Mode Adaptation Issue

## Problem Description
User reported that the extension's translation text is hard to read in dark mode.
Specifically mentioned:
- URL: `https://nuxt.com/docs/4.x/getting-started/introduction`
- Symptom: Translation text remains black even when the website is in dark mode (or has a dark background), making it illegible.

## Analysis
The extension likely uses hardcoded text colors or default styles that do not adapt to the host page's background color or theme.
On websites with dark backgrounds, black text is invisible.

## Reproduction Plan
1. Create a local HTML page with dark background (#1a1a1a) and light text.
2. Run Playwright test to trigger translation on this page.
3. Capture screenshot to verify the visibility of the translated text.

## Links
- [Issue #14](https://github.com/hongyuan007/tapword-translator/issues/14)
