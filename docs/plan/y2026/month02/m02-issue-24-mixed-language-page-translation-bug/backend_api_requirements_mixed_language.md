# Backend API Requirements: Auto-Detect Support

## 1. Background & Context
We are implementing a feature to better handle "Auto-Detect" scenarios in the browser extension.
**Scenarios:**
1.  **Code-Switching Phrases**: Text containing both Source and Target languages (e.g., "you什么时候来" -> Target: "zh").
2.  **English Words in Chinese Context**: User selects "performance" on a page that is predominantly Chinese. The client heuristic might label this as "auto" (or we might rely on the existing "en" detection, but "auto" provides a safer "force translate to target" path).

**Current Problem**:
If the client sends `sourceLanguage="zh"` (because of context) and `targetLanguage="zh"`, the backend (or client) logic often falls back to translating to English.
If we want to force translation of a mixed phrase *into* Chinese, we need a way to tell the backend "The source is mixed/unknown, just translate it to the Target Language, do not assume it's already in the Target Language."

## 2. Affected APIs
The following APIs need to be updated to support the `"auto"` value for `sourceLanguage`.

1.  **Word Translation**: `POST /api/v1/translate`
2.  **Fragment Translation**: `POST /api/v1/translate/fragment`

## 3. Detailed Requirements

### 3.1. `sourceLanguage` Parameter Update
**Requirement**: The `sourceLanguage` field in the request body must accept the string value `"auto"`.

**Example Request:**
```json
{
  "text": "you什么时候来",
  "sourceLanguage": "auto",
  "targetLanguage": "zh",
  "context": { ... }
}
```

### 3.2. Business Logic Changes

#### A. Bypass "Same-Language" Fallback
**Current Behavior (Assumed)**:
If `sourceLanguage == targetLanguage` (e.g., both "zh"), the system might automatically switch the `targetLanguage` to "en" (or "ja" if source is "en").

**New Behavior**:
If `sourceLanguage == "auto"`, **DISABLE** this fallback logic.
*   Even if `targetLanguage` is "zh", proceed with translating *to* "zh".
*   Trust that the LLM can handle mixed input and unify it into the target language.

#### B. LLM Prompt Construction
The prompt sent to the LLM provider (Deepseek, OpenAI, etc.) needs to adapt when `sourceLanguage` is `"auto"`.

**Recommendation**:
In the system prompt or user prompt, mapped `auto` to a description like **"Auto-Detect"** or **"Auto-Detect"**.

*   **Prompt Instruction Example**:
    > "Translate the following **Auto-Detect** text to **Chinese**."
    > "Handle code-switching and unify the output into the target language."

**Do NOT**:
*   Do not treat it as "English" (might cause Chinese parts to be treated as garbage/noise).
*   Do not treat it as "Chinese" (might cause English parts to be treated as untranslatable proper nouns if the model assumes strict Source=Zh).

## 4. Verification Criteria
1.  **Request**:
    ```json
    { "text": "you什么时候来", "sourceLanguage": "auto", "targetLanguage": "zh" }
    ```
    **Expected Response**: `data.translation` should be "你什么时候来" (or similar valid Chinese).
    **Bad Response**: "you when come" (treated as pure Chinese -> English) or error.

2.  **Request**:
    ```json
    { "text": "T恤", "sourceLanguage": "auto", "targetLanguage": "zh" }
    ```
    **Expected Response**: `data.translation` could be "T恤" (if model thinks it's already Chinese) or "T-shirt" (if model interprets "Translate to Chinese" as "Explain/Standardize").
    *Note: The primary goal is to avoid errors and fallback loops.*

## 5. Timeline
Client-side changes are ready to be deployed. We need Backend support to be deployed first or simultaneously to avoid validation errors if `sourceLanguage` is strictly validated against an enum.
