# Plan for Auto-Detect Support

## 1. Documentation
- [x] Create Technical Proposal `docs/plan/y2026/m02-issue-24-mixed-language-page-translation-bug/proposal_mixed_language_support.md`

## 2. Implementation
### Frontend (`src/1_content`)
- [ ] Modify `src/1_content/handlers/TranslationPipeline.ts`: Implement `auto` detection heuristic.
- [ ] Modify `src/1_content/utils/languageDetector.ts`: Update `resolveTargetLanguage` to skip fallback for `auto`.

### Local LLM (`src/8_generate`)
- [ ] Modify `src/8_generate/utils/languageUtils.ts`: Add `auto` -> "Auto-Detect" mapping.

## 3. Verification
- [ ] Run E2E tests or manual verification using `tests/html/mixed_language_scenarios.html`.
