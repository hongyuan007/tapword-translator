# Automatic Word/Phrase Translation — Unified Interface Notes, Implementation Plan, and Task Assignment

*Created: 2026-03-10*  
*Status: Ready for implementation*  
*Related docs:*  
- `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-final.md`  
- `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-technical-framework.md`  
- `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-backend-api.md`

---

## 1. Purpose

This document is the implementation handoff for the V1 **Automatic Word/Phrase Translation** feature.

It consolidates:
- final interface agreement
- frontend/backend responsibility split
- implementation order
- task assignment
- delivery and acceptance expectations

This document should be treated as the execution baseline for V1.

---

## 2. Locked Product / MVP Scope

### In scope for V1
- Trigger only after a **successful manual translation**
- Operate only on the **current block**
- Each block may be processed **only once**
- Candidate type supports **word + phrase**
- **Phrase has priority** over overlapping word candidates
- Maximum **3** auto-translated items per block
- Candidate selection uses **LLM + hard rules**
- Reuse current translation UI with slight visual distinction
- Auto-translation visual weight must not exceed manual translation
- Settings include:
  - `enableAutoTranslate`
  - `userLevel` = `Beginner | Intermediate | Advanced`

### Out of scope for V1
- Full paragraph translation
- Page-wide scan
- Adaptive user learning
- Persistent semantic caching
- Rich debug payloads exposed to frontend
- Combined candidate-identification + batch-translation one-shot API

---

## 3. Unified Interface Agreement

### 3.1 Endpoint
- `POST /v1/translate/auto-candidates`

### 3.2 Request minimum contract

```ts
{
  sourceLang: string
  targetLang: string
  blockText: string
  manualTrigger: {
    text: string
    type?: 'word' | 'phrase'
    translation?: string
  }
  excludedTexts: string[]
  limit: number
  userLevel: 'Beginner' | 'Intermediate' | 'Advanced'
}
```

### 3.3 Response minimum contract

```ts
{
  traceId: string
  candidates: Array<{
    text: string
    type: 'word' | 'phrase'
    start: number
    end: number
    translation: string
    reason: string
    source: 'llm' | 'rule' | 'hybrid'
  }>
  meta: {
    sourceLang: string
    targetLang: string
    limitApplied: number
    degraded: boolean
    model?: string
  }
  warnings?: string[]
}
```

### 3.4 Locked field semantics

#### `blockText`
- Must be the **full raw plain text of the current block**
- Must not include text from other blocks
- All candidate matching and `start/end` offsets are defined **against this exact text**

#### `manualTrigger`
- Must represent the **exact word/phrase that was just manually translated successfully**
- It is the trigger anchor for this round of auto-candidate identification
- Backend should not return it again as an auto candidate

#### `excludedTexts`
- Must be collected **within current block scope only**
- Must not include content from other blocks
- Default content should include:
  - the current manual trigger text
  - already rendered manual translation texts in this block
  - already rendered auto-translation texts in this block
- Backend should exclude them during both candidate-identification handling and rule-based filtering

### 3.5 V1 contract restraint

Keep the V1 contract light.

Do **not** expose by default:
- `debug`
- `debugInfo`
- raw LLM outputs
- prompt text
- large intermediate ranking breakdown fields
- frontend decoration-only fields

Debugging should rely on server logs and `traceId`.

---

## 4. Responsibility Split

### Frontend (Kai)
Frontend owns:
- trigger timing after successful manual translation
- current block extraction
- block-scoped `pending / done` one-time control
- sending request payload using locked contract
- mapping `start/end` back to DOM range
- filtering against current rendered state
- sequential rendering
- UI reuse and slight auto/manual visual distinction
- settings UI and storage wiring
- frontend unit/E2E coverage

### Backend (Rui)
Backend owns:
- new endpoint implementation
- LLM-based candidate identification
- hard-rule enforcement
- phrase-over-word precedence
- deduplication and invalid-item filtering
- max-3 enforcement
- degrade-to-empty behavior
- rate limiting / concurrency protection
- backend test coverage

### Product (Mei Lin)
Product owns:
- requirement stability
- boundary clarifications if implementation reveals ambiguity
- acceptance wording support if needed

### CTO / Tech Lead (Lao Xue)
CTO owns:
- coordination
- interface freeze enforcement
- code review
- risk control
- final acceptance gate

---

## 5. Implementation Plan

### Phase 1 — Contract and settings baseline
**Goal:** freeze data shape and feature toggle inputs

Tasks:
- confirm endpoint contract in code-facing form
- add frontend settings schema/defaults/UI/i18n
- prepare backend validation schema

Exit criteria:
- frontend and backend use the same request/response definitions
- feature toggle and level setting are available in frontend config path

### Phase 2 — Backend candidate API
**Goal:** make candidate endpoint callable and stable

Tasks:
- add `POST /v1/translate/auto-candidates`
- add request validation
- implement LLM candidate identification
- implement hard-rule normalization/filtering
- add degrade-to-empty path
- add base rate limiting / concurrency guard

Exit criteria:
- endpoint returns stable schema
- phrase priority / max-3 / excludedTexts work on backend side
- failure path does not break callers

### Phase 3 — Frontend auto-translation coordinator
**Goal:** connect current manual success flow to auto follow-up flow safely

Tasks:
- add auto-translation coordinator
- hook after successful manual translation
- extract current block text
- add `pending / done` block state
- assemble request payload
- call backend endpoint

Exit criteria:
- auto flow only runs after successful manual translation
- same block does not trigger repeatedly
- disabled setting prevents request

### Phase 4 — DOM mapping and rendering
**Goal:** place candidates correctly and render without chaos

Tasks:
- map `start/end` offsets back to DOM ranges
- filter overlaps with current manual result
- filter overlaps with existing auto results
- render sequentially
- apply slight visual distinction for auto results

Exit criteria:
- candidate placement is stable enough for V1
- repeated/overlapping candidates do not create duplicate UI
- layout remains acceptable in normal cases

### Phase 5 — Test hardening and acceptance
**Goal:** reach release-ready confidence

Tasks:
- backend unit/integration tests
- frontend unit tests
- Playwright E2E scenarios
- final manual verification against requirement doc

Exit criteria:
- critical tests pass
- main acceptance scenarios pass
- no unresolved S1/S2 issues

---

## 6. Task Assignment

### Kai — Frontend
**Owner:** Frontend Dev

#### Deliverables
1. settings support
   - `enableAutoTranslate`
   - `userLevel`
2. auto-translation coordinator
3. block-scoped one-time state control
4. request payload assembly per locked contract
5. offset-to-DOM-range mapping
6. overlap filtering and sequential render flow
7. auto/manual visual distinction
8. Vitest + Playwright coverage

#### Frontend must explicitly verify
- auto flow only triggers after manual success
- same block does not retrigger
- candidate offset mapping is stable for target pages
- auto UI weight stays below manual UI weight

### Rui — Backend
**Owner:** Backend Dev

#### Deliverables
1. new endpoint `POST /v1/translate/auto-candidates`
2. request/response validation schema
3. LLM candidate-identification prompt and parser
4. hard-rule filter pipeline
5. phrase-priority logic
6. excludedTexts enforcement
7. max-3 enforcement
8. degrade-to-empty handling
9. basic rate limit / concurrency guard
10. Jest / integration coverage

#### Backend must explicitly verify
- endpoint contract stability
- parse failure returns safe degraded result
- phrase-over-word precedence is enforced server-side
- excludedTexts are excluded consistently

### Mei Lin — Product
**Owner:** Product Manager

#### Deliverables
1. stay available for boundary clarification
2. support acceptance wording if implementation exposes ambiguity
3. help confirm whether any visual distinction remains within product intent

### Lao Xue — CTO
**Owner:** Tech Lead / Reviewer

#### Deliverables
1. enforce contract freeze
2. review frontend/backend change lists
3. verify test coverage expectations
4. gate implementation before merge/release

---

## 7. Cross-Team Rules During Implementation

1. Do not reopen product scope unless there is a concrete implementation blocker.
2. Do not silently change interface fields after this document; surface proposed changes first.
3. If backend wants to rename/remove fields, sync before implementation drift occurs.
4. If frontend finds offset mapping instability, surface example cases immediately.
5. Prefer short, explicit sync messages with @mentions in Discord.

---

## 8. Delivery Order Recommendation

Recommended execution order:
1. Backend contract + validation skeleton
2. Frontend settings + request payload wiring
3. Backend candidate logic + degrade path
4. Frontend coordinator + block control
5. Frontend DOM mapping + rendering
6. Joint contract verification
7. Test completion
8. CTO review and acceptance gate

---

## 9. Acceptance Gate

Before implementation can be considered ready for approval, confirm all of the following:

### Product acceptance
- Trigger is correct
- Scope is correct
- Auto output stays low-noise and subordinate to manual translation

### Frontend acceptance
- block-scoped one-time trigger works
- DOM range mapping is stable on representative pages
- no duplicate/overlap chaos in normal cases

### Backend acceptance
- endpoint contract matches agreed minimum
- degrade path is safe
- phrase priority / dedupe / max-3 are enforced server-side

### QA acceptance
- critical automated tests pass
- no blocking regression in manual translation flow
- no S1/S2 unresolved defects

---

## 10. Final Execution Note

This feature is now considered **implementation-ready**.

The main engineering risk is no longer product ambiguity; it is execution quality in two places:
- backend candidate quality and safe degradation
- frontend offset-to-DOM-range mapping stability

As long as the contract remains frozen and both sides stay within the agreed boundary, V1 should be deliverable with controlled risk.
