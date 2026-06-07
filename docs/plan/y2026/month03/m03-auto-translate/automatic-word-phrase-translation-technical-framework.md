# Automatic Word/Phrase Translation — Technical Framework

*Created: 2026-03-10*
*Status: Draft for implementation alignment*
*Related requirement doc: `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-final.md`*
*Target branch: `feat/260306/auto-translate`*

## 1. Purpose

This document captures the agreed technical direction for implementing **Automatic Word/Phrase Translation** in `tapword-translator`.

It translates the finalized product requirements into an implementation framework covering:
- frontend/backend responsibility split
- trigger timing and processing flow
- data and state control
- risk areas
- implementation order
- test and acceptance focus

## 2. Implementation Goals

The implementation should preserve the existing manual-translation experience while adding a controlled, low-noise automatic follow-up flow.

Technical goals:
- Do not disrupt the current manual translation pipeline.
- Limit auto-translation strictly to the current block.
- Guarantee one-time processing per block.
- Reuse existing UI as much as possible.
- Keep rendering stable and avoid layout chaos.
- Keep candidate selection logic out of frontend heuristics.

## 3. Agreed Architecture Split

### 3.1 Frontend Responsibilities

Frontend owns:
- triggering auto-translation **after manual translation succeeds**
- extracting the current block
- block-level one-time state management (`pending` / `done`)
- sending candidate-identification requests
- collecting block-scoped exclusion context from existing manual/auto translations
- mapping returned candidate positions back to DOM ranges
- deterministic filtering against user actions and current rendered page state
- final display veto for unstable / conflicting / risky candidates
- rendering auto-translation results using existing translation UI, with auto word/phrase underlines unified to **Teal**
- sequential rendering to reduce layout shifts

### 3.2 Backend Responsibilities

Backend should own:
- candidate identification using **LLM + hard rules**
- semantic judgment of which candidates best support reading continuity
- context-aware ranking/prioritization of word/phrase candidates
- returning a stable candidate payload for frontend rendering
- improving candidate quality, without assuming every returned candidate will be rendered

Recommended principle:
> Frontend should not guess which terms are “unknown”; backend should decide candidates, frontend should decide where and how to render them.

## 4. Frontend Integration Points

Based on current code exploration, the feature should integrate with the existing content-side translation flow.

Key existing areas:
- `src/1_content/handlers/InputListener.ts`
  - current manual translation entrypoints
- `src/1_content/handlers/TranslationPipeline.ts`
  - current manual translation pipeline
  - preferred hook point: **after successful manual translation response and UI update**
- `src/1_content/utils/domSanitizer.ts`
  - existing block-related helpers such as closest block ancestor extraction
- `src/1_content/utils/contextExtractorV2.ts`
  - existing context extraction capability
- existing translation display / modal components
  - should be reused instead of building a separate rendering system

## 5. Trigger and Processing Flow

### 5.1 Trigger Timing

Auto-translation must be triggered only when all of the following are true:
- user has enabled `enableAutoTranslate`
- the current manual translation request succeeded
- the current block has not already been processed

### 5.2 Processing Flow

1. User manually translates a word or phrase.
2. Existing manual translation flow completes successfully.
3. Frontend locates the current block.
4. Frontend checks block state:
   - if `pending` or `done`, stop
   - otherwise mark block as `pending`
5. Frontend sends a candidate-identification request with block text and required settings/context.
6. Backend returns a dynamically budgeted candidate set with offsets / text / type / priority, always within the agreed capped upper bound.
7. Frontend maps candidates back to DOM ranges.
8. Frontend filters invalid or conflicting candidates:
   - duplicate candidates
   - overlap with the manually translated selection
   - overlap with existing manual word translation records in the current block
   - overlap with ranges already covered by manual sentence translations
   - overlap with already-rendered auto results
   - word candidates covered by phrase candidates
   - unstable matches or high-risk render cases
9. Frontend keeps only the final safe candidates allowed by the current block budget.
10. Frontend renders candidates sequentially.
11. Frontend marks the block as `done`.

If the request fails, frontend should end the auto flow gracefully and avoid breaking the manual result.

## 6. State and Control Model

### 6.1 Block State

Each block needs one-time lifecycle control:
- `idle`: not yet processed
- `pending`: candidate request in flight
- `done`: already processed

Purpose:
- prevent duplicate requests when users click multiple times within the same block
- prevent duplicate DOM mutations
- keep behavior deterministic

### 6.2 Candidate Constraints

Frontend filtering must enforce product constraints:
- rendered auto item count follows the agreed **dynamic block budget** within a capped upper bound
- **phrase priority over word**
- no duplicate candidates
- no overlap with manual translation target
- no overlap with existing manual translation records or sentence-translation-covered ranges
- no overlap with existing auto results
- any unstable, ambiguous, or high-risk candidate may be dropped by frontend

## 7. Candidate Interface Direction

Recommended minimum backend response shape:

```ts
candidates: Array<{
  start: number
  end: number
  text: string
  type: 'word' | 'phrase'
  priority: number
}>
```

Suggested request inputs:
- `blockText`
- `manualTrigger`
- `excludedTexts`
- `sourceLanguage`
- `targetLanguage`
- `level`
- optional block-budget hint fields if needed later

This is the minimum interface required for the frontend plan currently agreed.

## 8. Rendering Strategy

### 8.1 UI Reuse

The feature should reuse the existing translation UI system rather than introduce a second display framework.

### 8.2 Auto vs Manual Visual Distinction

Auto results should:
- remain visually consistent with the current translation experience
- use the system-defined **Teal** underline for both auto words and auto phrases
- have **slightly lower visual weight** than manual translations
- not create ambiguity about user intent

### 8.3 Rendering Order

Do **not** render multiple auto results in parallel if it causes unstable layout behavior.

Preferred V1 behavior:
- render sequentially
- prioritize page stability over speed
- if space is too dense, render fewer rather than forcing all candidates

## 9. Settings Changes

Required settings for V1:
- `enableAutoTranslate: boolean` (default `false`)
- `userLanguageProficiency: 'Beginner' | 'Intermediate' | 'Advanced'`

Frontend tasks include:
- extending settings types / storage
- adding settings UI entry points
- adding i18n keys
- wiring the values into the candidate request flow

## 10. Main Technical Risks

### Risk 1: DOM Range Mapping Accuracy

Biggest frontend risk.

Why it matters:
- returned candidate offsets must be mapped back to real page text
- repeated text, split text nodes, nested inline elements, and phrase overlaps increase failure risk

### Risk 2: Layout Shift / Visual Instability

Why it matters:
- existing tooltip and line-height adjustment behavior is primarily optimized for single translation events
- rendering multiple auto results may cause repeated reflow and visual jumpiness

Mitigation:
- sequential rendering
- lower visual weight
- allow rendering fewer items when layout is tight

### Risk 3: Duplicate Triggering

Why it matters:
- users may click multiple words in the same block quickly
- without `pending` state, the feature may issue repeated candidate requests

Mitigation:
- enforce `idle -> pending -> done` lifecycle

### Risk 4: API Cost and Latency

Why it matters:
- one manual translation may lead to extra candidate-identification plus follow-up translation work
- poor interface design could significantly increase cost and response time

Mitigation:
- keep V1 scoped
- enforce a conservative dynamic budget with capped upper bound
- consider later optimization to combine candidate identification and translation if needed

## 11. Recommended Implementation Order

1. Add settings schema, defaults, UI, and i18n.
2. Add auto-translation coordinator layer.
3. Add block extraction and one-time block state management.
4. Add candidate offset-to-DOM-range mapping.
5. Add candidate filtering and phrase-priority logic.
6. Reuse/extend current translation rendering for auto results.
7. Add visual distinction between manual and auto results.
8. Add unit and E2E coverage.

## 12. Testing Focus

Minimum test focus for V1:
- auto flow triggers only after successful manual translation
- auto flow does not run when feature toggle is off
- auto flow only affects the current block
- same block is not processed twice
- phrase candidates win over overlapping word candidates
- dynamic block-budget limits are respected within the capped upper bound
- overlaps with manual translation and existing manual records are filtered out
- repeated text in one block still maps to the correct DOM range
- proficiency level is passed correctly to the request
- auto UI has lower visual emphasis than manual UI

## 13. Acceptance-Oriented Technical Summary

The agreed V1 technical direction is:
- preserve the existing manual flow
- add a controlled auto-follow-up layer after manual success
- keep the feature local to one block and one pass
- let backend own semantic candidate selection
- let frontend own trigger control, DOM placement, and final display safety decisions
- keep manual translations strictly higher priority than auto results

This is considered a feasible implementation path with manageable risk, provided the frontend/backend boundary stays clear and the offset-to-range mapping is handled carefully.
