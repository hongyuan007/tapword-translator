# Automatic Word/Phrase Translation — Final Requirements
*Last updated: 2026-03-10*
*Product: tapword-translator*
*Status: Finalized for implementation planning*

## 1. Background and Goals

### Background
Users currently need to manually click each unknown word or phrase one by one while reading. This works for spot translation, but it creates friction when a single paragraph contains several comprehension blockers.

The product opportunity is not to automatically translate everything, but to help users continue reading smoothly after they have already signaled difficulty by manually translating one item.

### Goals
- **Primary goal:** Help users continue reading without interruption.
- **Secondary goal:** Reduce repetitive manual clicks within the same paragraph/block.

### Product Principle
This feature should provide **small, targeted, low-distraction** assistance. It must support the core reading flow rather than turn the page into a machine-translated view.

## 2. Non-Goals
This feature is **not** intended to:
- Translate the entire paragraph automatically.
- Scan and translate the whole page.
- Translate every possible unknown word.
- Expand automatically across multiple blocks.
- Become a full vocabulary-learning or memory system in V1.

## 3. Target User and Problem
### Target User
Users reading English content who can generally follow the text, but occasionally encounter several unfamiliar words or phrases in the same paragraph.

### Problem Statement
After manually translating one item, users may still face several nearby comprehension blockers. Repeating the same click workflow multiple times interrupts reading and increases friction.

## 4. User Stories

### P0 — Core Reading Flow
**As a reader, I want the system to automatically supplement a few key word/phrase translations in the current paragraph after I manually translate one item, so that I can keep reading with less interruption.**

#### Acceptance Criteria
1. Auto-translation is triggered only after a successful manual translation.
2. Auto-translation runs only when the feature is enabled.
3. Auto-translation is limited to the current block.
4. The same block is scanned at most once.
5. The system displays at most 3 auto-translated items per trigger.

### P0 — Personalization by Language Level
**As a reader, I want to set my English proficiency level so that the system can better decide which words or phrases are worth auto-translating.**

#### Acceptance Criteria
1. The settings include a language proficiency option.
2. Supported values are `Beginner`, `Intermediate`, and `Advanced`.
3. The selected proficiency level is passed into auto-translation candidate selection.

### P0 — Control Over Feature Behavior
**As a reader, I want to enable or disable auto-translation, so that I can control whether the page remains minimal or more assistive.**

#### Acceptance Criteria
1. The settings include an `enableAutoTranslate` toggle.
2. Default value is `false`.
3. When disabled, no auto-translation is triggered.

### P1 — Consistent but Distinguishable Display
**As a reader, I want auto-translations to feel like part of the existing translation system, while still being subtly distinguishable from my own manual actions.**

#### Acceptance Criteria
1. Auto-translation reuses the existing translation UI system.
2. Auto-translation remains visually lighter than manual translation.
3. Users can recognize that the result is system-supplemented rather than manually triggered.

## 5. Final MVP Scope

### Included in V1
1. Auto-translation is triggered after a successful manual translation.
2. Scope is limited to the current block only.
3. Each block can be auto-scanned only once.
4. The system supports **word + phrase** candidates.
5. If a phrase overlaps with a word, **phrase wins**.
6. A single trigger returns and displays at most **3** items.
7. Candidate selection uses **LLM + product hard rules**.
8. The feature is configurable via settings.
9. Failure is silent and must not break the manual translation flow.

### Explicitly Out of Scope for V1
1. Whole-paragraph translation.
2. Whole-page scanning.
3. Cross-block automatic expansion.
4. "Show more candidates" interactions.
5. Per-candidate confirmation workflow.
6. Long-term vocabulary memory / learned-word profile.
7. Advanced personalization or local difficulty models.

## 6. Trigger Conditions and Effective Scope

### Trigger Conditions
Auto-translation may run only when all of the following are true:
1. The user has enabled auto-translation.
2. The user has just completed a successful manual translation.
3. The current block has not already been auto-scanned.

### Effective Scope
- The system scans only the **current block**.
- The block should follow the existing nearest block-level ancestor logic.
- Typical examples include `<p>`, `<div>`, `<li>`, etc.
- The system must not expand beyond the current block in V1.

### Frequency Limit
- **One block, one auto-scan.**
- Repeated user actions inside the same block must not keep retriggering auto-translation.

## 7. Candidate Selection Rules

### Product Decision
V1 uses **LLM + hard rules**, not pure LLM-only selection.

### Why
- The LLM is good at judging contextual importance.
- Hard rules are needed to reduce noise, duplication, and unstable results.

### Candidate Granularity
- V1 supports both **single words** and **phrases**.
- If a phrase and a word overlap, the **phrase takes priority**.
- Covered words should not be translated again separately.

### Hard Rules
The candidate selection layer must at least apply the following filters:
1. Skip the word or phrase the user just manually translated.
2. Skip words already covered by a longer selected phrase.
3. Skip overly short tokens with no stable standalone meaning.
4. Skip punctuation, numbers, URLs, and obvious noise tokens.
5. Skip duplicate candidates within the same block.
6. Truncate final output to at most **3** items.

### Product Quality Principle
- Prefer **under-selection** over over-selection.
- The purpose is to supplement the most important comprehension blockers, not generate a vocabulary list.

## 8. Display Strategy

### Final Product Decision
Auto-translation does **not** need to be visually identical to manual translation, but it must remain **highly consistent** with the current translation UI system.

### Display Principles
1. Reuse the existing translation UI system.
2. Keep visual style consistent with manual translation.
3. Make auto-translation **slightly distinguishable** from manual translation.
4. Ensure auto-translation has **lower visual weight** than manual translation.

### Noise-Control Rules
1. Display at most **3** auto-translated items in the same block.
2. Do not use attention-grabbing animation for multiple auto results.
3. Avoid repeated overlapping highlights or stacked translations.
4. If local layout becomes too dense, show fewer results rather than cluttering the page.
5. Auto-translations must behave like supplemental reading aids, not the primary visual focus.

## 9. Settings

### Required Settings
- `enableAutoTranslate`
  - Type: Boolean
  - Default: `false`
  - Meaning: Enables/disables automatic supplementary translation.

- `userLanguageProficiency`
  - Type: Enum
  - Default: `Intermediate`
  - Supported values:
    - `Beginner`
    - `Intermediate`
    - `Advanced`

## 10. Failure Handling
- Auto-translation should run asynchronously in the background.
- If auto-translation fails, it should fail silently.
- Failure must not block or degrade the manual translation flow.

## 11. Acceptance Summary
This feature is considered acceptable for V1 when:
1. A successful manual translation can trigger one background auto-scan for the current block.
2. Auto-translation is controlled by settings and language proficiency.
3. The same block is scanned only once.
4. At most 3 items are displayed.
5. Phrase-over-word priority is respected.
6. Auto results are visually consistent with, but lighter than, manual results.
7. Failures do not interrupt the main reading flow.

## 12. One-Sentence Product Definition
After the user manually translates one item, the system should **carefully supplement a small number of key words/phrases within the current block** so the user can continue reading smoothly, instead of turning the page into an automatic machine-translation interface.
