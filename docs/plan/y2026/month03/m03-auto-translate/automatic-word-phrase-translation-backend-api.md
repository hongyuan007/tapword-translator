# Automatic Word/Phrase Translation — Backend API Proposal

*Created: 2026-03-10*
*Status: Draft for implementation alignment*
*Related docs:*
- `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-final.md`
- `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-technical-framework.md`

## 1. Background and Responsibility Boundary

The `tapword-translator` frontend will support an automatic follow-up translation flow after a successful manual translation.

The agreed responsibility split is:

### Frontend owns
- triggering auto-translation after manual translation success
- extracting the current block
- one-time block processing state (`pending` / `done`)
- mapping returned candidates back to DOM ranges
- overlap filtering against rendered results and existing manual translation records
- UI reuse and presentation
- final display veto for unstable or conflicting candidates

### Backend owns
- candidate identification using **LLM + hard rules**
- stable request/response contract for candidate selection
- semantic candidate selection, result normalization, filtering, ranking, and degradation behavior

Core principle:
> Backend decides **what** is worth suggesting; frontend decides **where**, **how**, and **whether** it is safe to render.

---

## 2. Why V1 Should Use a Separate Endpoint

### Decision
V1 should introduce a **new dedicated endpoint** for auto-translation candidate identification.

Recommended path:
- `POST /v1/translate/auto-candidates`

### Why not extend the existing translation endpoint
1. **Different responsibility**
   - Existing translation endpoints serve direct user-triggered translation.
   - Auto-candidate identification serves block-level follow-up suggestion logic.

2. **Different input semantics**
   - Auto-candidate identification requires block text, manual trigger context, excluded items, and user level.
   - This is meaningfully different from current translation request payloads.

3. **Lower risk**
   - A separate endpoint avoids destabilizing the existing manual translation path.

4. **Cleaner degradation**
   - If candidate identification fails, backend can safely return an empty result without impacting the main translation flow.

---

## 3. V1 Endpoint Definition

### 3.1 Path
- `POST /v1/translate/auto-candidates`

### 3.2 Request

Recommended V1 request shape:

```json
{
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "blockText": "The full text content of the current block...",
  "manualTrigger": {
    "text": "take off",
    "translation": "起飞 / 脱下"
  },
  "userLevel": "Intermediate",
  "excludedTexts": ["take off", "aircraft"],
  "limit": 5
}
```

### Required fields
- `sourceLang: string`
- `targetLang: string`
- `blockText: string`
- `manualTrigger: { text: string; translation?: string }`
- `userLevel: 'Beginner' | 'Intermediate' | 'Advanced'`

### Optional fields
- `excludedTexts?: string[]`
- `limit?: number`

### Request notes
- `limit` is a frontend budget hint, but backend must still enforce the agreed **capped upper bound**.
- `excludedTexts` is used to suppress known overlaps, repeated terms, or already-rendered items.
- `excludedTexts` should include the current manual trigger plus existing manual/auto translation texts in the current block.

---

## 4. Response Contract

### 4.1 Response shape

```json
{
  "traceId": "req_01HXYZ...",
  "candidates": [
    {
      "text": "look forward to",
      "type": "phrase",
      "start": 42,
      "end": 57,
      "translation": "期待",
      "score": 0.93,
      "reason": "important phrase for current paragraph understanding",
      "source": "hybrid"
    }
  ],
  "meta": {
    "sourceLang": "en",
    "targetLang": "zh-CN",
    "limitApplied": 5,
    "degraded": false,
    "model": "llm-model-name"
  },
  "warnings": []
}
```

### 4.2 Candidate structure

```ts
interface Candidate {
  text: string
  type: 'phrase' | 'word'
  start: number
  end: number
  translation: string
  score?: number
  reason: string
  source: 'llm' | 'rule' | 'hybrid'
}
```

### 4.3 Response notes
- `traceId` supports debugging and log correlation.
- `meta.degraded` should indicate whether fallback/degrade logic was applied.
- `warnings` can surface non-fatal issues, e.g. partial filtering or quality downgrade.

---

## 5. Candidate Identification Logic

### 5.1 LLM responsibilities
The LLM should:
- analyze the current `blockText`
- identify words or phrases that are most useful to translate for reading continuity
- consider the user’s `manualTrigger`
- consider the user’s `userLevel`
- decide when a candidate has **no stable standalone meaning** and should be skipped
- prefer meaningful phrases where phrase-level interpretation better matches reading comprehension
- provide translation suggestions and relative priority

### 5.2 Hard-rule responsibilities
Hard rules must constrain and normalize the LLM output before returning anything to frontend.

Rules should include at minimum:
1. candidate must be locatable in current `blockText`
2. remove duplicates
3. remove overlap with `excludedTexts`
4. remove obviously invalid or meaningless items
   - punctuation
   - pure numbers
   - URLs
   - symbols
   - too-short fragments without semantic value
5. prefer phrase over overlapping word
6. enforce the agreed capped upper bound, even when frontend asks for a larger dynamic budget

### 5.3 Suggested normalization order
1. parse LLM output
2. validate candidate structure
3. confirm candidate text can be matched in `blockText`
4. remove duplicates
5. remove excluded or overlapping items
6. apply phrase-over-word precedence
7. rank remaining items
8. trim to the agreed capped upper bound

---

## 6. Quality Guardrails and Degradation

Backend must never pass raw LLM output directly to frontend.

### Degrade-to-empty principle
This endpoint is an enhancement feature. When quality is uncertain, backend should prefer returning an empty candidate list.

### Direct degrade conditions
Return:
- `candidates: []`
- `meta.degraded: true`

When any of the following happens:
- LLM timeout
- LLM output cannot be parsed reliably
- candidate text cannot be matched in `blockText`
- all candidates are filtered out
- request is rate-limited
- model output quality is below minimum threshold

### Expected behavior
- auto-candidate failure must **not** affect manual translation success
- empty result is acceptable and preferred over noisy or unstable output

---

## 7. Cost, Performance, and Protection Strategy

### 7.1 Main cost driver
- LLM invocation is the dominant cost
- Cost scales with:
  - `blockText` length
  - request frequency
  - chosen model tier

### 7.2 Main latency driver
- LLM round-trip time is the main latency bottleneck
- filtering, deduplication, and ranking on the server are comparatively cheap

### 7.3 Caching strategy
V1 may ship **without heavy caching**.

Reason:
- request inputs are context-sensitive (`blockText`, `manualTrigger`, `excludedTexts`, `userLevel`)
- cache reuse may be limited initially

Optional V1.1 enhancement:
- lightweight short-TTL cache keyed by normalized request signature

### 7.4 Rate limiting and concurrency protection
V1 should include basic protection:
- per user / per token rate limit
- global concurrency guard for model access

Purpose:
- avoid auto-candidate traffic overwhelming model capacity
- keep manual translation path protected from auxiliary feature load

---

## 8. Error Handling

Recommended behavior:
- validation errors → standard 4xx response
- internal/server/model failures → soft-fail where possible
- candidate-quality failures → 200 response with empty candidates and `meta.degraded: true`

Suggested split:
- **400/422** for malformed request
- **429** for explicit rate limiting
- **200 degraded** for model/path quality failures where frontend can safely continue
- **500** only for genuine unrecoverable server faults

---

## 9. Test Recommendations

### Unit tests
At minimum, cover:
- candidate deduplication
- phrase-over-word precedence
- invalid candidate filtering
- excluded text filtering
- capped dynamic-budget enforcement
- degrade-to-empty behavior
- matching candidates back to `blockText`

### Integration tests
At minimum, cover:
- valid request returns stable schema
- malformed request returns validation error
- timeout / parse failure returns degraded empty result
- rate limit returns expected response behavior
- mixed candidate input still results in normalized ordered output

---

## 10. Recommended Development Order

1. Define endpoint contract and validation schema.
2. Implement response normalization pipeline.
3. Implement LLM prompt + parse logic.
4. Implement hard-rule filtering and ranking.
5. Add degrade-to-empty handling.
6. Add rate limiting / concurrency protection.
7. Align prompt/rules with frontend-owned exclusion semantics.
8. Add unit + integration coverage.
9. Align with frontend on trace/debug fields.

---

## 11. Non-V1 / Future Enhancements

These are explicitly **not required for V1**:
- combine candidate identification and batch translation into a single richer response pipeline
- adaptive candidate selection based on user history
- persistent caching with semantic reuse
- per-user learning or suppression memory
- ranking feedback loop from frontend interaction

Possible V2 direction:
- move toward a single endpoint that returns both ranked candidates and ready-to-render translations in one call, if latency/cost measurements justify it

---

## 12. Key Backend Acceptance Criteria

1. **Contract stability**
   - endpoint accepts agreed request shape and returns stable `traceId + candidates + meta + warnings` structure

2. **Result containment**
   - backend always enforces phrase priority, deduplication, filtering, and the agreed capped upper bound

3. **Safe degradation**
   - under timeout, parse failure, bad quality, or rate limiting, backend returns empty/degraded results without impacting the manual translation flow
