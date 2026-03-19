# Read Frog Alignment Review Report

**Date**: 2026-03-16  
**Scope**: Review of `docs/plan/y2026/m03-full-translate/analysis/260316_readfrog_alignment_comparison.md` against actual TapWord and Read Frog implementations  
**TapWord codebase**: `/Users/hongyuan/project/v2/tapword-translator`  
**Read Frog codebase**: `/Users/hongyuan/project/read-frog`

## Purpose

This report evaluates which items in `260316_readfrog_alignment_comparison.md` are reasonable and should be treated as **must-fix before this commit**, and which items should be deferred or rejected as non-blocking.

The comparison document is used as input only. Final recommendations in this report are based on:

- `docs/plan/y2026/m03-full-translate/analysis/read_frog_architecture_analysis.md`
- actual TapWord implementation under `src/11_full_translate/`
- actual Read Frog implementation under `/Users/hongyuan/project/read-frog/src/`

## Review Standard

An item is recommended as **must-fix before this commit** only if it satisfies at least one of these conditions:

1. It causes clear behavioral bugs in the current TapWord full-page translation flow.
2. It creates visible user-facing regressions on common sites.
3. It materially breaks cleanup/session correctness.
4. The fix is small-to-medium in scope and aligns with the current TapWord architecture.

Items that are mainly product enhancements, optional UX improvements, or larger architecture upgrades are **not** treated as must-fix for this commit.

## Recommended Must-Fix Items

### 1. Shadow DOM initial collection and cleanup gaps

**Recommendation**: Must fix in this commit.

**Why this is reasonable**

TapWord already walks shadow roots and observes shadow-root mutations, so shadow DOM support is an intended capability, not an out-of-scope feature.

However, the current implementation is incomplete:

- `src/11_full_translate/PageTranslationManager.ts`
  - `start()` walks `document.body`
  - `collectParagraphs()` uses `querySelectorAll()` only on the light DOM subtree
- `src/11_full_translate/dom/renderer.ts`
  - `removeAllTranslations()` uses `document.querySelectorAll()`
  - `removeWalkLabels()` also uses standard DOM querying only

This means:

1. existing paragraph nodes inside shadow roots are not collected for initial viewport observation
2. cleanup can leave translated wrappers or walk labels inside shadow roots

Read Frog handles this more completely with deep paragraph collection and deep cleanup traversal.

**Conclusion**

This is a real correctness issue and should be fixed before commit.

---

### 2. Missing wrapper metadata: translation mode, walk session, `dir`, `lang`

**Recommendation**: Must fix in this commit.

**Why this is reasonable**

TapWord wrapper creation in `src/11_full_translate/dom/renderer.ts` currently sets only classes, but does not set:

- translation mode attribute
- walked session attribute on wrapper
- `dir`
- `lang`

Read Frog sets all of these on translated wrappers.

The impact differs by attribute:

- `dir` and `lang` are correctness-related for RTL targets and international text rendering
- translation mode attribute makes cleanup and restore strategy explicit
- walked session metadata improves session association and future re-translation safety

This is a low-risk, high-value alignment item. It improves correctness without forcing major architecture changes.

**Conclusion**

This should be fixed before commit.

---

### 3. Incomplete site-specific skip selectors

**Recommendation**: Must fix in this commit.

**Why this is reasonable**

TapWord currently has a clearly reduced selector set in `src/11_full_translate/constants/index.ts` compared with Read Frog:

- missing `arxiv.org`
- missing `www.reddit.com`
- smaller YouTube selector set
- smaller Discord selector set
- one fewer GitHub selector

This is not just an architectural difference. It directly changes visible behavior on common sites by allowing translation of UI chrome, metadata, and other areas that should stay untouched.

This category is exactly where Read Frog’s production hardening is most relevant. The current TapWord implementation is likely to show obvious noise on YouTube, Reddit, GitHub, Discord, and arXiv.

**Conclusion**

This is a strong must-fix item for the current commit.

---

### 4. Missing deepest-child unwrap and truncation-style smashing

**Recommendation**: Should fix in this commit unless scope must be cut very aggressively.

**Why this is reasonable**

Read Frog’s `unwrapDeepestOnlyHTMLChild()` and `smashTruncationStyle()` address a real rendering problem on modern content sites:

- text is often nested under multiple wrapper elements
- cards and feeds often use line clamp, max-height, or ellipsis truncation

TapWord currently lacks both behaviors. As a result:

1. translated content can be inserted at the wrong wrapper level
2. translated content can remain clipped or invisible under truncation styles

This is especially relevant for article cards, social feeds, and content-heavy pages, which are typical targets for full-page translation.

**Conclusion**

This is a reasonable pre-commit fix and is recommended together with the three must-fix items above.  
If scope is constrained, it is the first item that could be downgraded from "must" to "strong should".

## Reasonable But Not Must-Fix For This Commit

### 1. Translation-only HTML-preserving rendering

The comparison document is correct that Read Frog has a much richer `translationOnly` mode.

However, current TapWord entry wiring in `src/1_content/handlers/FullTranslateHandler.ts` hardcodes:

- `mode: 'bilingual'`

So the full `translationOnly` path is not currently the active user path. The gap is real, but it should not block this commit unless this commit also plans to expose or rely on translation-only mode.

### 2. More advanced request queue and rate limiting

Read Frog’s `RequestQueue` is more sophisticated:

- deduplication
- per-request timeout
- scheduled retries
- runtime configurability

TapWord is simpler, but still functional for the current architecture because it already has:

- batch queueing
- retry for batch-count mismatch
- token bucket limiting
- background-side batch API call

This is a quality upgrade, not a pre-commit blocker.

### 3. Error UI for failed paragraphs

Read Frog provides user-visible paragraph-level error UI. TapWord currently logs errors silently.

This is a valid improvement, but it is not as critical as shadow DOM correctness, wrapper metadata, or skip-selector quality. It should not block this commit unless the current change set already touches failure UX.

### 4. Document title translation

Read Frog translates `document.title` and tracks title changes. TapWord does not.

This is useful, but it is a product enhancement rather than a core page-translation correctness issue.

### 5. Translation styling presets and decoration

Read Frog supports custom styling of translated nodes. TapWord currently renders plain translated text.

This is not a must-fix for alignment before this commit.

### 6. Article-context-aware translation

Read Frog primes article context and uses page-level content awareness for LLM translation.

This may improve quality, but it is a larger product capability, not a direct correctness blocker for the current TapWord implementation.

### 7. Touch trigger and per-element toggle

These are product features from Read Frog, not necessary for current TapWord full-page translation correctness.

## Comparison Document Items That Should Not Be Taken Literally As Must-Fix

### 1. "Auto source language is missing"

This conclusion is too strong.

TapWord full-page translation config is currently built with:

- `sourceLang: 'auto'`

See `src/1_content/handlers/FullTranslateHandler.ts`.

So the project is not missing the concept of auto source language. A more accurate statement is:

- TapWord does not currently implement Read Frog’s richer language-detection and paragraph filtering strategy for full-page translation

That is different from "missing auto source language".

### 2. Walkability transition cache is a meaningful refinement, but not a hard blocker

Read Frog tracks a cache of previously non-walkable elements and only reacts on transition to walkable.

TapWord uses a simpler visibility-based approach in `src/11_full_translate/utils/DynamicContentObserver.ts`.

The comparison document is fair that TapWord is less precise. But this is mostly an optimization and edge-case stability improvement, not a top pre-commit blocker compared with the must-fix items above.

## Final Recommendation

### Must fix before this commit

1. Shadow DOM initial paragraph collection and deep cleanup
2. Wrapper metadata: translation mode, walk session, `dir`, `lang`
3. Site-specific skip selectors for common sites

### Strongly recommended in this commit

4. Deepest-child unwrap and truncation-style smashing

### Defer for later unless current scope expands

1. Full `translationOnly` parity with HTML preservation
2. Request-queue deduplication, timeout, and advanced scheduling
3. Paragraph-level error UI
4. Document title translation
5. Translation style customization
6. Article context awareness
7. Touch trigger and per-element toggle

## Practical Commit Guidance

If this commit needs a strict minimal scope, the recommended implementation order is:

1. Fix shadow DOM collection and cleanup
2. Add wrapper metadata
3. Expand custom skip selectors
4. Add unwrap + truncation handling

This order gives the best balance of correctness, visible quality improvement, and implementation cost.
