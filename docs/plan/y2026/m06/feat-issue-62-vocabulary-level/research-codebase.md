# 现有功能调研：tapword-translator 查词流程分析

> 调研日期：2026-06-14
> 调研目标：确定词汇等级信息应该嵌入到查词/翻译流程的哪个环节

## 核心结论

词汇等级数据应在**后端 API 响应层**新增字段，沿着现有的 `TranslationApiResponse → TranslationResult → TranslateResponseMessage.data → SuccessState → TranslationDetailData` 数据链路贯穿至 UI，最终在 **modal 模板（modal-success.html）** 中单词旁边以 badge 形式展示。Tooltip 不展示等级（空间有限），仅 modal 详情中展示。

## 查词/翻译流程概览

```
用户选中文本
  → InputListener.handleTextSelection()           [1_content/handlers/InputListener.ts]
  → iconManager.show(range)                        [1_content/ui/iconManager.ts]
  ── 用户点击图标 ──
  → InputListener.handleIconClick()
  → TranslationPipeline.handleIconClick(range)     [1_content/handlers/TranslationPipeline.ts]
  → processTranslation(range, triggerSource)
      ├── languageDetector.detectSourceLanguageAsync()
      ├── selectionClassifier.detectSelectionType()
      └── translateWordPath() OR translateFragmentPath()
            ├── extractContextV2(range)             [1_content/utils/contextExtractorV2.ts]
            ├── translationDisplay.showTranslationResult(range, word, loadingState, ...)  ← 先渲染 loading
            │                                       [1_content/ui/translationDisplayV2.ts]
            ├── translationRequest.requestTranslation(payload)
            │   └── chrome.runtime.sendMessage({ type: "TRANSLATE_REQUEST", data })
            │       └── MessageRouter → TranslationRequestHandler     [2_background/]
            │           └── translateModule.translateWord(params)     [6_translate/]
            │               └── post<TranslationApiResponse>(API_ENDPOINT, request)  ← 云端 API
            │                   └── 返回 TranslationApiResponse → 映射为 TranslationResult
            └── translationDisplay.updateTranslationResult(anchorId, successState)   ← 更新为成功
                                                                    ↓
                              TranslationDetailData 构建 → translationModal (点击后展开详情)
```

## 关键模块和文件

### 1. 触发入口

| 文件 | 关键函数 | 职责 |
|------|---------|------|
| `src/1_content/handlers/InputListener.ts` | `handleTextSelection()`, `handleIconClick()` | 监听 mouseup/click/dblclick/keydown 事件，分发到 TranslationPipeline |
| `src/1_content/handlers/TranslationPipeline.ts` | `handleIconClick()`, `processTranslation()` | 核心编排器：语言检测 → 分类（word/fragment）→ 调用翻译 → 渲染结果 |
| `src/1_content/ui/iconManager.ts` | `show()`, `removeTranslationIcon()` | 在选中文本旁显示翻译触发图标 |

### 2. 翻译请求构建

| 文件 | 关键函数 | 职责 |
|------|---------|------|
| `src/1_content/utils/contextExtractorV2.ts` | `extractContextV2()` | 从 DOM Range 提取选中文本 + 前后句上下文 |
| `src/1_content/utils/languageDetector.ts` | `detectSourceLanguageAsync()` | 异步语言检测（Chrome API + franc-min fallback） |
| `src/1_content/handlers/utils/selectionClassifier.ts` | `detectSelectionType()` | 分类选中范围为 "word" 或 "fragment" |
| `src/1_content/services/translationRequest.ts` | `requestTranslation()`, `requestFragmentTranslation()` | 构建 Chrome message 并发送到 background |

**消息类型定义** (`src/0_common/types/index.ts`):
```typescript
// 请求
interface TranslateRequestMessage {
    type: "TRANSLATE_REQUEST"
    data: TranslationContextData  // { word, leadingText, trailingText, sourceLanguage, targetLanguage, ... }
}

// 响应（成功）
interface TranslateResponseSuccessMessage {
    type: "TRANSLATE_RESPONSE"
    success: true
    data: {
        wordTranslation: string
        sentenceTranslation?: string
        chineseDefinition?: string
        englishDefinition?: string
        targetDefinition?: string
        lemma?: string | null
        phonetic?: string
        lemmaPhonetic?: string
    }
}
```

### 3. 翻译执行（Background → 云端 API）

| 文件 | 关键函数 | 职责 |
|------|---------|------|
| `src/2_background/messaging/MessageRouter.ts` | `setupMessageListener()` | Chrome 消息路由总入口 |
| `src/2_background/handlers/TranslationRequestHandler.ts` | `handleTranslationRequest()` | 接收消息 → 配额检查 → 调用翻译服务 → 返回响应 |
| `src/6_translate/services/TranslationService.ts` | `translateWord()`, `translateFragment()` | 核心翻译业务逻辑，多 provider 路由 |
| `src/6_translate/types/TranslationApiTypes.ts` | `TranslationApiRequest`, `TranslationApiResponse` | 后端 API 请求/响应类型 |

**后端 API 响应数据结构** (`TranslationApiResponse`):
```typescript
interface TranslationApiResponse {
    wordTranslation: string
    sentenceTranslation?: string
    provider: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
}
```

**业务层返回类型** (`TranslationResult`):
```typescript
interface TranslationResult {
    wordTranslation: string
    sentenceTranslation?: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
}
```

### 4. 结果展示

#### 4a. Tooltip（浮动卡片 / 下划线翻译）

| 文件 | 关键函数 | 职责 |
|------|---------|------|
| `src/1_content/ui/translationDisplayV2.ts` | `showTranslationResult()`, `updateTranslationResult()` | UI 协调器：管理 tooltip 生命周期、位置、状态更新 |
| `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` | `renderTooltipContent()`, `setTooltipText()` | tooltip DOM 创建和内容渲染 |
| `src/1_content/ui/translationDisplayV2/types.ts` | `SuccessState`, `TranslationEntry` | tooltip 状态类型定义 |

**Tooltip SuccessState 数据结构**:
```typescript
interface SuccessState {
    status: "success"
    translation: string
    sentenceTranslation?: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    targetLanguage?: string
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
}
```

Tooltip 仅展示 `translation`（翻译文本），其他字段（词典、音标等）不在此展示。

#### 4b. Modal（详情弹窗 / 点击翻译后展开）

| 文件 | 关键函数 | 职责 |
|------|---------|------|
| `src/1_content/ui/translationModal.ts` | `showTranslationModal()`, `updateTranslationModal()` | 详情弹窗生命周期管理，Shadow DOM 隔离 |
| `src/1_content/ui/modalTemplates.ts` | `renderSuccessTemplate()`, `createDictionarySection()` | HTML 模板渲染，变量替换 |
| `src/1_content/resources/modal-success.html` | — | Word 翻译成功时的 HTML 模板（含单词、翻译、音标、操作按钮） |
| `src/1_content/resources/section-dictionary.html` | — | 词典区段 HTML 模板（含 lemma、音标、释义） |
| `src/1_content/resources/modal-success-fragment.html` | — | Fragment 翻译成功时的 HTML 模板 |

**Modal 数据结构** (`TranslationDetailData`):
```typescript
interface TranslationDetailData {
    status: TranslationStatus          // "loading" | "success" | "error"
    translationType: TranslationType   // "word" | "fragment"
    text: string                       // 原文
    translation: string                // 翻译
    originalSentence?: string
    sentenceTranslation?: string
    leadingText?: string
    trailingText?: string
    errorMessage?: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    targetLanguage?: string
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
    sourceLanguage?: string
    onDelete?: () => void
    onRefresh?: () => void
}
```

**Modal UI 结构**（modal-success.html）:
```html
<div class="ai-translator-modal-view">
  <div class="ai-translator-modal-top-row">
    <div class="ai-translator-modal-left-group">
      <div class="ai-translator-modal-word-section">
        <div class="ai-translator-modal-word">{{WORD}}</div>            ← 词汇等级 badge 的候选位置
        <div class="ai-translator-modal-word-translation">{{TRANSLATION}}</div>
      </div>
      <div class="ai-translator-modal-phonetic-group">
        <div class="ai-translator-modal-phonetic">{{PHONETIC}}</div>
        <button class="ai-translator-speak-btn">...</button>
        <button class="ai-translator-refresh-btn">...</button>
        <button class="ai-translator-delete-btn">...</button>
      </div>
    </div>
    <button class="ai-translator-modal-close">×</button>
  </div>
</div>
{{ORIGINAL_SENTENCE_SECTION}}
{{DICTIONARY_SECTION}}
```

### 5. 数据存储

当前翻译结果**不做持久化缓存**。翻译结果仅在内存中维护：

- `activeTranslations: Map<string, TranslationEntry>` — 在 `translationDisplayV2.ts` 中管理的内存 Map
- 页面刷新或 SPA 导航后自动清除（`SpaNavigationHandler` 监听路由变化 → `clearAll()`）

## 词汇等级嵌入点分析

### 数据流全链路（Word 翻译路径）

```
后端 API 返回 JSON
  → TranslationApiResponse (6_translate/types/TranslationApiTypes.ts)
  → TranslationResult (6_translate/types/TranslationModels.ts)      ← 在 TranslationService.ts 做字段映射
  → TranslateResponseSuccessMessage.data (0_common/types/index.ts)  ← 在 TranslationRequestHandler.ts 构造响应
  → SuccessState (1_content/ui/translationDisplayV2/types.ts)       ← 在 TranslationPipeline.ts 提取字段
  → TranslationDetailData (1_content/ui/translationModal.ts)        ← 在 translationDisplayV2.ts 构建
  → modalTemplates.renderSuccessTemplate()                          ← 渲染到 HTML 模板
```

### 候选嵌入点对比

| 候选嵌入点 | 优势 | 劣势 | 改动范围 |
|-----------|------|------|---------|
| **A. API 响应层（推荐）** — 从后端返回 `vocabularyLevel` 字段，沿现有数据链路贯穿 | 数据来源权威（后端判定）；与现有 `lemma`、`phonetic` 等字段同层级，模式一致；前端只需逐层透传 | 需要后端 API 同步修改；非官方 provider（microsoftFree/googleFree/custom）不返回此字段 | API 类型定义 + 逐层透传字段（~8 个文件），详见下方 |
| **B. 前端独立查询** — 前端拿到 `lemma` 或 `word` 后，单独调用第三方词汇等级 API | 不依赖后端改动；支持所有 provider | 增加额外网络请求；需要额外维护等级数据源或 API；与现有架构模式不一致 | 新增独立查询模块 + 缓存层 + UI 渲染（~5 个新文件 + 2 个改动） |
| **C. 前端本地词库** — 扩展内置词汇等级词典（如 COCA 词频表），本地查找 | 零网络延迟；完全离线可用 | 增加扩展包体积；词库维护成本高；等级标准不灵活 | 新增词库数据文件（可能数 MB）+ 查找逻辑 + UI 渲染 |

## 推荐方案

### 方案 A：API 响应层嵌入（推荐）

**核心思路：** 在 `TranslationApiResponse` 中新增 `vocabularyLevel` 字段，沿现有数据链路透传到 UI，在 modal 模板中渲染 badge。

### 需要改动的文件清单

| # | 文件路径 | 改动内容 | 改动类型 |
|---|---------|---------|---------|
| 1 | `src/6_translate/types/TranslationApiTypes.ts` | `TranslationApiResponse` 新增 `vocabularyLevel?: string` 字段 | 新增字段 |
| 2 | `src/6_translate/types/TranslationModels.ts` | `TranslationResult` 新增 `vocabularyLevel?: string` 字段 | 新增字段 |
| 3 | `src/6_translate/services/TranslationService.ts` | `translateWordWithCloud()` 返回映射中增加 `vocabularyLevel: data.vocabularyLevel` | 透传字段 |
| 4 | `src/0_common/types/index.ts` | `TranslateResponseSuccessMessage.data` 新增 `vocabularyLevel?: string` | 新增字段 |
| 5 | `src/2_background/handlers/TranslationRequestHandler.ts` | `sendResponse` 中增加 `vocabularyLevel: result.vocabularyLevel` | 透传字段 |
| 6 | `src/1_content/ui/translationDisplayV2/types.ts` | `SuccessState` 新增 `vocabularyLevel?: string` | 新增字段 |
| 7 | `src/1_content/handlers/TranslationPipeline.ts` | `translateWordPath()` 中 `updateTranslationResult()` 调用增加 `vocabularyLevel` 字段 | 透传字段 |
| 8 | `src/1_content/ui/translationModal.ts` | `TranslationDetailData` 接口新增 `vocabularyLevel?: string` | 新增字段 |
| 9 | `src/1_content/ui/translationDisplayV2.ts` | `showTranslationResult()` 和 `updateTranslationResult()` 中 `TranslationDetailData` 构建增加 `vocabularyLevel` | 透传字段 |
| 10 | `src/1_content/ui/modalTemplates.ts` | `renderSuccessTemplate()` 中增加 `{{VOCABULARY_LEVEL_BADGE}}` 变量渲染 | 渲染逻辑 |
| 11 | `src/1_content/resources/modal-success.html` | 在 `{{WORD}}` 旁增加 `<span class="vocabulary-level-badge">{{VOCABULARY_LEVEL_BADGE}}</span>` | UI 模板 |
| 12 | `src/1_content/resources/modal.css` | 新增 `.vocabulary-level-badge` 样式 | CSS 样式 |

### UI 展示位置

**在 modal-success.html 的单词区域，紧贴单词右侧放置等级 badge：**

```html
<div class="ai-translator-modal-word-section">
    <div class="ai-translator-modal-word">
        {{WORD}}
        <span class="vocabulary-level-badge" data-level="{{VOCABULARY_LEVEL}}">{{VOCABULARY_LEVEL_LABEL}}</span>
    </div>
    <div class="ai-translator-modal-word-translation">{{TRANSLATION}}</div>
</div>
```

**Tooltip（浮动卡片）不展示等级**，原因：
- Tooltip 空间极为有限，仅显示翻译文本（有 200 字符截断）
- 等级信息属于"详细信息"，与词典释义、音标同层级，适合 modal 展示

### 注意事项

1. **仅影响 Word 翻译路径：** `vocabularyLevel` 只在 word 翻译时有意义，fragment 翻译不需要
2. **非官方 provider 缺失处理：** microsoftFree/googleFree/custom LLM 不返回此字段，UI 需要处理 `undefined` 情况（不渲染 badge）
3. **后端 API 需同步修改：** 后端需要在翻译 API 响应中增加 `vocabularyLevel` 字段（如 CET-4/CET-6/IELTS/TOEFL 等等级标记）
4. **i18n 支持：** 等级标签可能需要国际化（如 "CET-4" → "四级"）
