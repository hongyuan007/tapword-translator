# Task: #22 网络翻译失败修复

## Status: Phase 3 — Verification ✅

## Phases
- [x] Phase 1: Research
- [x] Phase 2: Implementation
- [ ] Phase 3: Verification
- [ ] Phase 4: Review
- [ ] Phase 5: Branch & PR

## Files Changed
- `src/6_translate/services/TranslationService.ts` — Added 15s timeout to cloud translation requests; split `handleAPIError()` to distinguish network/timeout errors from server errors
- `src/0_common/locales/en.json` — Added `error.networkError`, `error.networkTimeout`, `error.short.networkError`, `error.short.networkTimeout`
- `src/0_common/locales/zh.json` — 同上
- `src/0_common/locales/de.json` — 同上
- `src/0_common/locales/es.json` — 同上
- `src/0_common/locales/fr.json` — 同上
- `src/0_common/locales/ja.json` — 同上
- `src/0_common/locales/ko.json` — 同上
- `src/0_common/locales/ru.json` — 同上

## Research Output
- Analysis spec: `docs/plan/y2026/m03-network-fail/analysis/260323_0001_network-fail-fix.md`

## Key Findings
1. **Root cause**: School firewall blocks client→API connection. `fetch()` throws TypeError which gets wrapped as `unexpectedError` then mapped to generic "server busy" message.
2. **No timeout on translation requests**: `APIService.performRequest()` supports timeout but TranslationService never passes one.
3. **No fallback for international users**: `fallbackBaseURL` only works for Chinese users on `auto` mode.
4. **Backend is fine**: The issue is entirely client-side network blocking.

## Implementation Details (Phase 2)
1. **Timeout**: Added `TRANSLATION_REQUEST_TIMEOUT_MS = 15000` constant, passed as `{ timeout }` option to both `post()` calls for word and fragment cloud translation
2. **Error classification**: `handleAPIError()` now distinguishes:
   - `timeout` → "network timeout" message
   - `requestError` with 5xx → "server busy" (unchanged)
   - `requestError` with 4xx/no code → "network error"
   - `unexpectedError` → "network error" (Failed to fetch = blocked)
3. **i18n**: 4 new keys added to all 8 locale files

## Type-Check Result
- Pre-existing error: `src/2_background/services/ServiceInitializer.ts(9,65): TS2307` — unrelated to this change
- **No new type errors introduced**

## Notes
- Issue: #22 - 连接美国学校网络后翻译失败，切换到手机热点翻译正常
- 类型: Bug (P2/S2)
- 涉及仓库: 前端(tapword-translator) only (backend no changes needed)
- 评论者建议: 后续提供服务选择即可
