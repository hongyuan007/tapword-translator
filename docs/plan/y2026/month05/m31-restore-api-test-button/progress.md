# Progress

- 2026-05-31: Completed root-cause analysis for the missing Test button in Options -> Translation Engine -> Add AI Provider.
- 2026-05-31: Wrote analysis/spec at `docs/plan/y2026/m31-restore-api-test-button/analysis/260531_restore_api_test_button_analysis.md`.
- 2026-05-31: Confirmed the button is absent from the add-form DOM, while a separate inline edit form still contains a working test flow.
- 2026-05-31: Restored the Test button to the add-provider form in `src/4_options/index.html`.
- 2026-05-31: Reused the existing provider connectivity test flow via a shared helper in `src/4_options/modules/translationEngineManager.ts` for both add and inline edit forms.
- 2026-05-31: Kept add-form Save/Cancel behavior unchanged while resetting transient test UI state when the form opens or closes.