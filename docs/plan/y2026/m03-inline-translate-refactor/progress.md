# Refactor: Extract Auto-Translate → `9_inline_translate` Module

## Task ID: m03-inline-translate-refactor

## Status: Complete

## Description
Extract the auto-translate capability into a standalone `src/9_inline_translate/` module.
Remove all trigger entry points (popup UI, TranslationPipeline calls, message router case).
Preserve the underlying scanning/translation/rendering pipeline for future integration with full-text translation.

## Progress
- [x] Research phase completed
- [x] Spec created
- [x] Module extracted
- [x] Trigger entry points removed
- [x] Verification passed
