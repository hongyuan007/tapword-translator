---
name: tapword-review-expert
description: "Perform code review for TapWord Translator, a Chrome extension and frontend TypeScript project. Use when asked to review a PR, diff, implementation, or code change in this repository, especially for Manifest V3 lifecycle issues, content-script/host-page interactions, popup or options UI regressions, translation flow changes, repository convention drift, or risky cross-module boundary changes."
---

# TapWord Review Expert

Review code changes in this repository with a zero-trust mindset. Prioritize concrete bugs, regressions, security issues, MV3 violations, and project-specific convention breaks over style suggestions.

## Review Goals

- Find the issues that should block merge or require follow-up.
- Check whether the change fits this repository's extension architecture and coding conventions.
- Be explicit about behavioral risk on hostile web pages, SPA lifecycle, async messaging, storage-backed state, and UI interaction flows.

## Severity Model

| Level | Meaning | Typical outcome |
|-------|---------|-----------------|
| `P0` | Security issue, store-policy violation, severe data loss, or fundamentally broken extension behavior | Must block merge |
| `P1` | High-confidence functional regression, MV3 lifecycle bug, broken cross-context contract, or major UX break | Fix before merge |
| `P2` | Moderate correctness, resilience, or maintainability issue with user-visible or future-change risk | Fix in this PR or track immediately |
| `P3` | Minor improvement, low-risk cleanup, or convention drift without immediate product impact | Optional follow-up |

## Workflow

### 1. Scope the review

- Inspect the current change set with `git status -sb`, `git diff --stat`, and `git diff`.
- Identify the affected layers:
  - `src/1_content`: content scripts, selection, overlay UI, hostile-page integration
  - `src/2_background`: service worker, message routing, storage-backed coordination
  - `src/3_popup`: popup UI and settings interactions
  - `src/5_backend`, `src/6_translate`, `src/7_speech`, `src/8_generate`: business flows and API-facing logic
  - `manifest`, build config, assets, or localization files
- Read the module README for every changed module before judging behavior in that module.

### 2. Load the right references

- Always read `references/project-review-checklist.md`.
- Read `references/extension-runtime-and-page-checklist.md` when the change touches `src/1_content`, `src/2_background`, `manifest.json`, permissions, message passing, lifecycle handling, DOM integration, or floating UI.
- Read `references/repo-conventions-checklist.md` when the change touches shared utilities, exports, types, logging, localization, or file organization.

### 3. Review in this order

1. Confirm the intended behavior from the diff, nearby code, and relevant README files.
2. Check for `P0` and `P1` issues first:
   - MV3 lifecycle misuse
   - unsafe DOM injection or trust-boundary mistakes
   - message contract breakage
   - storage, async, or race-condition bugs
   - permission or manifest expansion without strong justification
3. Check project-specific regression risks:
   - hostile-page CSS or event conflicts
   - SPA navigation and stale DOM anchor handling
   - selection, overlay, tooltip, and note-card cleanup
   - popup state assuming immediate background or storage availability
   - translation request/response typing and fallback behavior
4. Check repository convention drift only after behavior is understood:
   - `@/` imports instead of relative imports
   - namespace imports for functions and variables
   - explicit `index.ts` exports only
   - `createLogger()` instead of `console.*`
   - concise comments only where the code would otherwise be hard to parse

### 4. Judge reviewer confidence

- Prefer findings you can tie to a concrete execution path, contract mismatch, or architectural invariant.
- Call out uncertainty explicitly when a risk depends on code outside the diff.
- Do not invent issues to fill the report. If there are no findings, state that directly and list only residual risks or testing gaps.

## Project-Specific Review Heuristics

### Extension runtime and boundary checks

- Treat background state as ephemeral unless it is persisted or reconstructible.
- Verify `runtime.onMessage` handlers preserve async response semantics and typed payload contracts.
- Check that content-script logic fails safely when extension context becomes invalid or when the host DOM mutates unexpectedly.
- Review manifest and permission changes with least-privilege expectations.

### Host page and UI interaction checks

- Assume the host page may use aggressive CSS, SPA rerenders, nested scroll containers, and conflicting event handlers.
- Check whether overlays, icons, note cards, and listeners are attached, repositioned, and cleaned up correctly across selection changes, scroll, resize, and navigation.
- Watch for logic that only works on static pages or on ideal selection geometry.

### Repository convention checks

- Review whether the change respects module boundaries instead of pulling business logic into infrastructure or UI-only layers.
- Check that new shared types or utilities were read and reused instead of duplicated.
- Flag magic values that should be named constants when they encode stable behavior.

## Output Contract

Follow the active conversation language policy. If no language policy exists, prefer Simplified Chinese for reviewer-facing prose in this repository.

Present findings first, ordered by severity.

Use this structure:

```markdown
## Findings

### P1
1. `[path/to/file.ts:123]` Short title
Reason the behavior is wrong or risky, why it matters in this repository, and the likely fix direction.

### P2
2. `[path/to/other-file.ts:45]` Short title
...

## Open Questions
- Missing context that could change confidence or severity.

## Change Summary
- One short paragraph only after findings.

## Residual Risks
- Mention unverified paths, missing tests, or scenarios not exercised.
```

When emitting inline review comments, keep the range tight and explain the actual failure mode, not just the violated preference.

## Review Boundaries

- Do not default to implementation work unless the user asks for fixes.
- Do not spend most of the review on style if there are correctness or architecture risks.
- Do not treat speculative nits as findings.
- Do not assume existing code is correct just because the diff is small.
