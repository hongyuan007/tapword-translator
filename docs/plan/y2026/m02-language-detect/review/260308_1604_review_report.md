# 代码审查报告

**审查对象**: `m02-language-detect` — selectionLang 语言检测修复  
**审查日期**: 2026-03-08  
**审查版本**: `260308_1604`  
**被审查文件**:
- `src/1_content/handlers/TranslationPipeline.ts`
- `src/1_content/utils/languageDetector.ts`

---

## 🛡️ Review Summary（总体评估）

本次修改尝试解决 `chrome.i18n.detectLanguage` 对短文本（如单个英文单词）的统计误判问题。核心策略是将 `selectionLang` 的检测输入从被选中词本身（`sanitizedText`）改为其所在段落上下文（`textForRouting`），并在 `detectSourceLanguageAsync` 中增加一个对短纯 ASCII 文本的"快速路径"兜底。

从整体架构看，这两个改动**对主要使用场景（中文用户阅读英文页面）有效**，CJK 检测逻辑未受影响，`resolveTargetLanguage` 的 `"auto"` 处理仍然正确。

**但存在两个值得关注的设计问题**：
1. `routingLang` 和 `selectionLang` 现在从完全相同的输入派生，造成重复 API 调用且二者永远相等；
2. `selectionLang` 的语义从"所选文本的语言"变为"段落上下文的语言"，在多语言混合页面上存在偏差。

此外，`SHORT_ASCII_THRESHOLD = 10` 的阈值低于分析文档中提到的 ~15 字符可靠性边界，留下了覆盖缺口。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES（严格规则违规）

**未发现 CRITICAL 或 HIGH 级别问题。**

检查项确认：
- ✅ 无 `eval` / `new Function` / 远程 JS 注入
- ✅ Background 脚本无全局可变状态
- ✅ 无 `innerHTML` 注入未消毒数据
- ✅ 无硬编码 API 密钥或敏感信息
- ✅ 异步消息回调已有 `return true`（原有代码，未改动）
- ✅ Content Script 事件监听器移除逻辑未改动
- ✅ 无 `any` 类型新增于消息负载

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS（架构与逻辑分析）

### 1. 【重复调用】`routingLang` 与 `selectionLang` 使用完全相同的输入，产生两次 API 调用

**位置**: `TranslationPipeline.ts` 第 122 行 vs 第 129 行

```typescript
const routingLang = await languageDetector.detectSourceLanguageAsync(textForRouting) // 第 122 行
const selectionLang = await languageDetector.detectSourceLanguageAsync(textForRouting) // 第 129 行
```

修改后，两个变量的输入完全一致。由于 `detectSourceLanguageAsync` 无内部缓存，这意味着会对同一文本发起**两次串行的 `chrome.i18n.detectLanguage` 调用**。在正常情况下，两次调用的返回值必然相同（`routingLang === selectionLang`），二者的区分已无实际意义。

**风险**：
- 浪费异步时间（两次 Chrome API 往返）；
- 二者永远相等的事实在代码层面隐藏了一个潜在的设计缺陷——如果未来某个 commit 只改动了其中一处，Review 者很难察觉这两个变量原本是应该相等的。

**建议（供 Owner 决策）**：可将两次调用合并为一次：`const detectedLang = await languageDetector.detectSourceLanguageAsync(textForRouting)`，然后将 `detectedLang` 同时用于 `isCJKLanguage` 判断和下游的 `translateWordPath` / `translateFragmentPath`。

---

### 2. 【语义偏移】`selectionLang` 的含义已从"所选词的语言"变为"段落的语言"

**位置**: `TranslationPipeline.ts` 第 125–129 行注释与 `translateWordPath` / `translateFragmentPath` 中的 `sourceLanguage`

**原始设计意图**：`selectionLang` 代表"被选中文本本身是什么语言"，用于告知翻译 API `sourceLanguage`。`routingLang` 代表"这个段落是什么语言"，仅用于决定 word-boundary 切分策略（CJK vs 空格分隔）。两者**可以不同**：例如，用户在法语页面上选中了一个英文技术术语 `"API"`。

**修改后的问题**：二者现在恒等。对于多语言混合页面，翻译 API 收到的 `sourceLanguage` 不再反映所选词的真实语言，而是段落的语言。具体场景：

| 场景 | 选中文本 | 段落语言 | `sourceLanguage` 发送值 | 期望值 | 差异 |
|---|---|---|---|---|---|
| 法语文章中的英文词 | `"API"` | `"fr"` | `"fr"` | `"en"` | ❗ 语义错误 |
| 英文文章中的法文引用 | `"bonjour"` | `"en"` | `"en"` | `"fr"` | ❗ 语义错误 |
| 英文文章中的英文词 | `"nominated"` | `"en"` | `"en"` | `"en"` | ✅ 正确（主要场景） |

**实际影响评估**：现代 LLM 通常能从上下文（`leadingText`、`trailingText`、`originalSentence`）中推断出正确的源语言，即使 `sourceLanguage` 字段不准确也能产出合理翻译。因此在主要使用场景下，**功能仍然正确**。但在多语言混合页面上，这是一个隐性的语义错误，当未来排查翻译质量问题时可能造成困惑。

---

### 3. 【阈值缺口】`SHORT_ASCII_THRESHOLD = 10` 低于文档声称的可靠性边界

**位置**: `languageDetector.ts` 第 19–20 行；分析文档 `260308_1527_selectionlang-fix.md` 第 1 节

分析文档明确指出："Chrome 的统计 n-gram 模型要求足够的文本来积累有意义的信号。短词（< ~15 字符）通常低于此阈值。" 然而常量设置为 10，而非 15。

这意味着长度在 11–15 字符之间的英文单词（如 `"innovations"` = 11、`"accommodations"` = 14）**仍然会进入 Chrome API**，可能被误判（如 `"ko"` 或 `"la"`）。

**重要上下文**：由于 Change 1 已经将检测输入改为 `textForRouting`（段落级别的文本，通常 50–500+ 字符），此阈值在实践中只会在 `textForRouting` 本身较短时才触发（例如：页面内容稀疏、标题节点等）。因此这个缺口在大多数页面上不会实际触发。但对于内容极其精简的页面，11–15 字符的纯 ASCII 块文本仍存在被误判的风险。

---

### 4. 【符号/数字假阳性】`PRINTABLE_ASCII_REGEX` 包含非字母字符

**位置**: `languageDetector.ts` 第 20 行

```typescript
const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]+$/
```

此正则表达式匹配所有可打印 ASCII 字符，包括数字（`0–9`）和符号（`!@#$%^&*+-`等）。以下输入会触发快速路径并返回 `"en"`：

- `"3.14159265"` (10 chars) → `"en"` （这是一个数字，无语言属性，返回 `"en"` 影响可接受）
- `"$100.00!!"` (9 chars) → `"en"` （同上，金融符号语言无关）
- `"Hello!!!!!"` (10 chars) → `"en"` （英文 + 符号，正确）
- `"123456789!"` (10 chars) → `"en"` （纯数字，语言无关，可接受）

**评估**：对于此扩展的使用场景（翻译页面文本），纯数字或纯符号串被选中翻译的概率极低，且即使触发，`sourceLanguage: "en"` 对翻译 API 没有有害影响（LLM 会识别这是非词汇内容）。**属于可接受的边界条件**。

---

### 5. 【日志语义不一致】注释与实际行为不匹配

**位置**: `TranslationPipeline.ts` 第 130 行

```typescript
logger.info(`[${triggerSource}] Selection language (selected text):`, selectionLang)
```

日志消息写的是 `"selected text"`，但实际值来自 `textForRouting`（段落上下文）。这会导致未来读取日志时产生误判：开发者会以为看到的是被选中词的检测结果，而实际上是段落的检测结果。相比之下，`routingLang` 的日志（第 123 行）正确标注了 `"block context"`。

---

### 6. 【主要场景验证】CJK 场景链路正确性

针对任务中要求验证的几个关键混合语言场景，逐一核实：

**场景 A：选中 `"you"` from `"you今天来不来"`**
- `textForRouting` = `"you今天来不来"` → 含 CJK → `PRINTABLE_ASCII_REGEX` 不匹配 → 快速路径**不触发** ✅
- Chrome API → `hasCJK=true, hasLatin=true` → 返回 `"auto"` ✅
- `selectionLang = "auto"`, `routingLang = "auto"`
- `hasCJK(sanitizedText="you") = false` → `isCJKLanguage = false` → 空格分隔路径
- `translateWordPath("you", "auto", ...)` → `resolveTargetLanguage("auto", "zh") = "zh"` ✅
- **链路正确**

**场景 B：选中整个 `"you今天来不来"`**
- `sanitizedText = "you今天来不来"` → `hasCJK = true` → `isCJKLanguage = true` → fragment 路径 ✅
- `selectionLang = "auto"` → `resolveTargetLanguage("auto", "zh") = "zh"` ✅
- **链路正确**

**场景 C：选中 `"你好"` (2个CJK字符)**
- `textForRouting` 含 CJK → `PRINTABLE_ASCII_REGEX` 不匹配 → 快速路径**不触发** ✅
- Chrome API → `"zh"` ✅
- **链路正确**

**场景 D：英文页面上选中 `"nominated"` (9 chars) — 修复目标场景**
- `textForRouting` = 英文段落 (~200 chars) → 远超阈值 10 → 快速路径**不触发**
- Chrome API 对段落返回 `"en"` ✅
- `selectionLang = "en"` → API 收到 `sourceLanguage: "en"` ✅（修复前为 `"la"`）
- **主要场景正确，修复有效**

**场景 E：法语或德语页面**
- `textForRouting` = 法语/德语段落 → Chrome API 返回 `"fr"` / `"de"` ✅
- `isCJKLanguage = false` → 空格分隔路径 ✅
- `selectionLang = "fr"` → `sourceLanguage: "fr"` → 翻译目标 `"zh"` ✅
- 与 Change 1 之前相比：**对法/德页面的短词检测也有改善**（单词"bonjour"→可能被误识，段落"bonjour ..."→准确检测为 "fr"）

**场景 F：日语/韩语纯 CJK 页面**
- `textForRouting` 含 CJK → Chrome API → `"ja"` 或 `"ko"` ✅
- `isCJKLanguage = true` (via `["ja","ko"].includes(routingLang)`) → fragment 路径 ✅
- **链路正确**

---

## 💡 SUGGESTIONS（建议）

### S1. 消除重复调用，合并为单次检测

```typescript
// 建议: 单次调用，同时服务 routing 和 selection 两个用途
const detectedLang = await languageDetector.detectSourceLanguageAsync(textForRouting)
const routingLang = detectedLang  // 用于 isCJKLanguage 判断
const selectionLang = detectedLang // 用于下游翻译 API
```

或直接消除两个独立变量，统一使用 `detectedLang`。

### S2. 修正具有误导性的日志消息

```typescript
// 现在（误导）
logger.info(`[${triggerSource}] Selection language (selected text):`, selectionLang)

// 建议
logger.info(`[${triggerSource}] Selection language (block context):`, selectionLang)
```

### S3. 考虑将 `SHORT_ASCII_THRESHOLD` 提高至 15 以对齐文档描述

分析文档中提到 "< ~15 chars" 是 Chrome 检测不可靠的边界。如果此安全网的意图是完全覆盖该范围，阈值应调整为 15。不过需权衡：更高阈值会把更多非英语的短纯 ASCII 文本错误识别为英语（例如：某些拉丁语系语言中的短词）。

### S4. 代码注释优化（`languageDetector.ts`）

当前注释提到 "Chinese users reading English content" —— 这是业务层面的假设，写入基础设施层（`languageDetector.ts`）有轻微的架构分层违规感。可将其改为更中性的描述（例如："For extensions primarily serving users who translate *into* their native language from foreign-language pages"），以遵守 `core.md` 中"基础设施代码应与业务逻辑无关"的原则。

---

## 结论

| 维度 | 评估 |
|---|---|
| 主要场景修复效果（英文词 → "en"） | ✅ 有效 |
| CJK 检测正确性 | ✅ 未受影响 |
| 混合 CJK+Latin 场景链路 | ✅ 正确 |
| 非英语页面（法/德/日/韩） | ✅ 无回退，多数场景改善 |
| 冗余 API 调用 | ⚠️ 存在，建议合并 |
| 短词阈值覆盖缺口（11–15 chars） | ⚠️ 低风险，现实中少见 |
| 多语言混合页面语义偏差 | ⚠️ 低优先级，LLM 可容忍 |
| 日志可读性 | ⚠️ 轻微误导，建议修正 |
| CRITICAL/HIGH 规则违规 | ✅ 无 |
