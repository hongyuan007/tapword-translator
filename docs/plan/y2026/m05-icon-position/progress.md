# Task: m05-icon-position (Issue #31)

- **Issue**: #31 - 自定义划词翻译图标的出现位置
- **Type**: Feature (enhancement)
- **Difficulty**: Low
- **Repository**: tapword-translator (frontend only)
- **Workflow**: A (Standard)
- **Started**: 2026-03-23 03:01

## Progress

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Research | ✅ Complete | Spec doc written |
| Phase 2: Implementation | ✅ Complete | All changes implemented |
| Phase 3: Verification | 🔄 In Progress | |
| Phase 4: Review | ⏳ Pending | |
| Phase 5: Branch & PR | ⏳ Pending | |

## Files Changed
- `src/0_common/types/index.ts` — Added `IconPosition` type, added `iconPosition` field to `UserSettings`, default `"bottom-right"`
- `src/1_content/ui/iconManager.ts` — Rewrote position calculation: 4 corners + auto mode, viewport clamping, scroll offset handling
- `src/1_content/handlers/InputListener.ts` — Pass `settings.iconPosition` to `showTranslationIcon()`
- `src/4_options/index.html` — Added radio button group for icon position in Appearance section
- `src/0_common/locales/en.json` — Added 6 i18n keys
- `src/0_common/locales/zh.json` — Added 6 i18n keys (Chinese translations)
- `src/0_common/locales/ja.json` — Added 6 i18n keys (Japanese translations)
- `src/0_common/locales/ko.json` — Added 6 i18n keys (Korean translations)
- `src/0_common/locales/fr.json` — Added 6 i18n keys (French translations)
- `src/0_common/locales/de.json` — Added 6 i18n keys (German translations)
- `src/0_common/locales/es.json` — Added 6 i18n keys (Spanish translations)
- `src/0_common/locales/ru.json` — Added 6 i18n keys (Russian translations)

## Notes
- 纯前端改动，不涉及后端
- Type-check passes (only pre-existing error in ServiceInitializer.ts unrelated to this change)
- Default `"bottom-right"` preserves backward compatibility
