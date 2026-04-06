# 14_inline_translate — Inline Translation Module

## Purpose

Content-script-level orchestration and DOM utilities for inline (auto) translation. After a user manually translates a word or phrase, this module scans the surrounding block element, requests auto-candidate translations from the backend, filters them through a multi-stage pipeline, and renders the results using the existing translation display system.

## Architecture

- **Fire-and-forget design**: Auto-translation never blocks or interferes with the manual translation flow.
- **Scan-once semantics**: Each block element is scanned at most once per page lifecycle to avoid duplicate work.
- **Conservative filtering pipeline**: Multi-stage filtering (exclusion, dedup, DOM mapping, overlap detection, density budget) ensures only high-confidence candidates are rendered.

## Module Structure

```
src/14_inline_translate/
  index.ts                              — Module exports
  README.md                             — This file
  services/
    InlineTranslationService.ts         — Core orchestration: trigger → extract → request → filter → render
  utils/
    blockTextExtractor.ts               — Extracts block text with text-node-to-offset mapping
    candidateDomMapper.ts               — Maps backend offsets to live DOM Range objects
```

## Dependencies

- `0_common` — Shared types (`AutoCandidate`, `UserSettings`), constants, logger
- `1_content` — Display rendering (`translationDisplayV2`), overlap detection, DOM sanitization, messaging bridge (`requestAutoCandidates`)
- `5_backend` — Indirectly via `1_content` messaging to background service worker

## What This Module Does NOT Include

- Backend request handlers (`2_background`)
- Cloud/local API services (`6_translate`, `8_generate`)
- LLM prompt templates (`resources/8_generate/auto_candidates/`)
- CSS rendering rules (`1_content/resources/content.css`)

These remain in their respective infrastructure modules and are consumed indirectly via the messaging pipeline.
