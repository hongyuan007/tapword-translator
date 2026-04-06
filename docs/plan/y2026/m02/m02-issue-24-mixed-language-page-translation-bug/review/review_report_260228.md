# Code Review Report: Mixed Language Fix & Issue #24

## 🛡️ Review Summary
本次提交通过引入**独立选区语言检测 (`selectionLang`)**，有效地解决了“中文页面下选中英文单词无法正确翻译”的核心问题（Issue #24）。将“路由语言”（用于分词策略）与“翻译源语言”（用于API请求）解耦是一个优秀的架构决策。

**但是**，为了处理混合文本（如 "you什么时候来"）而新增的**启发式逻辑（Heuristic Logic）存在严重的设计缺陷**。该逻辑过于激进，会导致常见含字母中文词汇（如 "T恤"、"A股"）的“中译英”功能失效（Regression），并且会破坏目标语言为英文的用户的体验。

建议**保留双重检测机制，但移除或重写混合文本的启发式判断**。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES
*本次审查未发现严重的安全漏洞（Security）或 V3 规范违反（Violation）。但发现一处**高风险的逻辑回归（High Logic Regression）**。*

### 🔴 Logic Regression: 启发式判断破坏了“字典模式”
**Location:** `src/1_content/handlers/TranslationPipeline.ts` (Line 149)
```typescript
const selectionLang = (isCJKDetectedForSelection && /[a-zA-Z]/.test(sanitizedText)) ? "en" : rawSelectionLang
```
**Problem:** 使用 `/[a-zA-Z]/`（任何拉丁字母）作为强制判定为英文的条件过于宽泛。
**Scenario:**
1. 用户选中 **"T恤"** 或 **"A股"**（识别为 ZH，但包含字母）。
2. 逻辑强制将 `sourceLanguage` 设为 `"en"`。
3. 用户的目标语言通常为 `"zh"`。
4. 后端请求变为：`Source: "en" -> Target: "zh"`。
5. **结果**: LLM 将 "T恤" (视为英文) 翻译为 "T恤" (中文)。
6. **预期行为**: 用户通常希望选中中文词汇时查看其英文释义（即 `Source: "zh" -> Target: "zh" -> Fallback: "en"`，结果为 "T-shirt"）。
**Consequence:** 该修改导致用户无法查询含字母中文词汇的英文翻译。

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 1. [Design Pattern] 意图与实现的分离 (Intent vs. Implementation)
目前的修复逻辑通过“欺骗”下游系统（谎称源语言是英文）来绕过 `resolveTargetLanguage` 中的“同语言Fallback”机制。
*   **现状**: 为了让 "you什么时候来" (ZH) 翻译成中文，强制标记其为 EN，防止系统将其 fallback 到 EN 翻译。
*   **风险**: 这种 Hack 导致了系统状态的不一致。如果用户的目标语言本身就是英文（English Learner），系统会认为 `Source: "en" -> Target: "en"`，从而触发 `Fallback: "ja"`（日文），导致用户看到日文翻译。

### 2. [Heuristics] 启发式算法的脆弱性
在处理自然语言时，简单的正则表达式（如 `/[a-zA-Z]/`）往往不足以判定语言属性。
*   **混合文本的本质**: "you什么时候来" 实际上是 **Code-switching（语码转换）** 现象。
*   **建议**: 不要修改 `sourceLanguage`。应该在 Prompt 层面处理。例如，保持 `Source: "auto"` 或 `Source: "mixed"`，让后端 LLM 智能处理“将混合文本统一翻译为目标语言”。

### 3. [Separation of Concerns] 关注点分离（Good）
将 `routingLang`（决定是否按词/按句处理）与 `selectionLang`（决定翻译方向）分离是非常正确的。
*   `routingLang` 依赖上下文（Block Scope），保证了在中文环境选中英文单词时，依然能正确识别出不需要分词扩展（如果上下文是中文）。*（注：此处逻辑需确认，如果 Context 是中文，选中英文单词，是否应该按英文分词规则扩展？代码中 Line 157 `if (isCJKLanguage)` 使用的是 `routingLang`。如果 `routingLang` 是 ZH，选中 "performance"，会走 Fragment 路径而不是 Word 路径，可能导致无法自动扩展选中完整的单词 "performance"。这可能是一个潜在的副作用，但优于之前的错误翻译。）*

---

### 💡 SUGGESTIONS

#### 1. 修复建议：移除激进的启发式逻辑
建议删除以下代码块，仅依赖 `detectSourceLanguageAsync` 的结果：
```typescript
// ❌ Remove this heuristic
// const selectionLang = (isCJKDetectedForSelection && /[a-zA-Z]/.test(sanitizedText)) ? "en" : rawSelectionLang
```
Issue #24 的核心（英文单词在中文页面被误判）已经通过 `const rawSelectionLang = await languageDetector.detectSourceLanguageAsync(sanitizedText)` 解决了。因为 "performance" 会被检测为 "en"，从而正确翻译。

#### 2. 改进混合文本处理（Optional）
如果必须支持 "you什么时候来" -> "你什么时候来" 的场景，建议修改 `resolveTargetLanguage` 的逻辑，而不是修改源语言检测。
例如，当检测到 Source 为 ZH 但 Target 也为 ZH 时，先检查文本是否包含大量非中文字符。如果是，则不触发 Fallback，而是保持 Target=ZH（视为“修正”模式）。

#### 3. 测试用例补充
在 `tests/html/mixed_language_scenarios.html` 中补充“回归测试”用例：
*   **Case 5: Chinese term with letters**
    *   Content: "我想买一件 **T恤**。"
    *   Expected: Source="zh", Translation="T-shirt" (Target: ZH -> Fallback EN).

---

### Update: "False Positive" Fix (2026-02-28)
User reported an issue where selecting an English word ("having") on an English page triggered the **CJK Fragment Path** (and UI), skipping word expansion.
**Cause**:
1. `chrome.i18n.detectLanguage` incorrectly identified "having" as "ko" (Korean).
2. The `selectionLang` logic set `isCJKDetectedForSelection = true`.
3. The routing logic `isCJKLanguage` became true because of this flag.

**Fix**:
Implemented `languageDetector.hasCJKCharacters(text)` utility to robustly check for actual CJK characters.
Updated `TranslationPipeline.ts`:
1. `selectionLang` ("auto") now requires `hasCJKCharacters(text)` to be true.
2. `isCJKLanguage` routing now requires `hasCJKCharacters(text)` instead of relying solely on language detection labels.

This ensures that words like "having" (no CJK characters) will never accidentally trigger the CJK/Fragment path, regardless of what the language detector says.

