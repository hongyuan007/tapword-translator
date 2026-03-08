# 语言检测异常分析报告 (Analysis Report: Language Detection Anomaly)

## 1. 问题描述 (Problem Description)
用户反馈在某些情况下，单词翻译详情页中没有词典和音标数据。
根据提供的日志，我们发现这是由于前端语言检测（`chrome.i18n.detectLanguage`）在处理短文本（如单个单词 "internally"）时出现误判，导致向后端发送了错误的 `sourceLanguage`。

## 2. 日志分析 (Log Analysis)

关键日志片段如下：

```text
index.js:1 [languageDetector] Starting async language detection: I'm in pretty much the same situation...
index.js:1 [languageDetector] Chrome detected language: en
index.js:1 [selectionHandler] [Single Click] Routing language (block context): en
...
index.js:1 [languageDetector] Starting async language detection: internally
index.js:1 [languageDetector] Chrome detected language: kk
index.js:1 [selectionHandler] [Word Path] Translating word: internally | Language: kk
...
index.js:1 [translationRequest] ... "sourceLanguage": "kk"
```

**分析结论**：
1.  **上下文检测正确**：`Routing language` 基于周围长文本正确检测为 `en` (English)。
2.  **单词检测错误**：针对单词 "internally"，`chrome.i18n` 误判为 `kk` (Kazakh，哈萨克语)。
3.  **请求参数错误**：`TranslationPipeline` 采用了单词级别的检测结果 (`kk`) 作为 `sourceLanguage` 发送给后端。
4.  **后果**：后端接收到 `sourceLanguage: "kk"`，因此不会尝试查找英语词典或生成英语音标，导致前端详情页缺失这些信息。

## 3. 代码逻辑分析 (Code Logic Analysis)

### 3.1. `src/1_content/handlers/TranslationPipeline.ts`
该文件负责协调翻译流程。目前逻辑如下：

```typescript
// 1. 获取上下文文本并检测语言 -> routingLang
const textForRouting = domSanitizer.getSurroundingTextForDetection(range, 30)
const routingLang = await languageDetector.detectSourceLanguageAsync(textForRouting)

// 2. 获取选中各文本并检测语言 -> selectionLang
const selectionLang = await languageDetector.detectSourceLanguageAsync(sanitizedText)

// ...

// 3. 在 Word Path 中使用 selectionLang 发起请求
await translateWordPath(workingRange, word, selectionLang, limiter, loadingVariant)
```

**缺陷**：虽然计算了 `routingLang`，但目前仅用于判断是否为 CJK 语言（决定分词策略），未用于纠正或辅助 `selectionLang` 的结果。对于短文本，`chrome.i18n` 的准确率较低，容易受随机性影响出现误判。

### 3.2. `src/1_content/utils/languageDetector.ts`
该文件封装了 `chrome.i18n.detectLanguage`。
- 它只取返回结果中的第一个语言 (`result.languages[0]`)。
- 它包含针对 CJK 的一些后处理逻辑（如纠正纯拉丁字符被误判为 CJK 的情况），但没有处理其他语种（如 `kk`）的误判。
- 它目前不支持利用外部提供的“提示语言”（Hint Language）来优化检测结果。

## 4. 解决方案建议 (Proposed Solution)

为了解决此问题，我们应利用已知的上下文语言 (`routingLang`) 来辅助判断单词的语言。

### 方案 A：改进 `detectSourceLanguageAsync` (推荐)
修改 `src/1_content/utils/languageDetector.ts`，允许传入一个可选的 `contextLang` 参数。

**逻辑**：
1.  调用 `chrome.i18n.detectLanguage` 获取所有可能的语言列表（不仅仅是第一个）。
2.  如果 `contextLang` 存在于列表中（即使不是第一位），且置信度差异不大，优先选择 `contextLang`。
3.  或者，如果检测到的语言与 `contextLang` 不一致，且输入文本非常短（如单次），且文本特征（如字符集）与 `contextLang` 兼容，则强制使用 `contextLang`。

### 方案 B：在 `TranslationPipeline` 中进行调和
在 `TranslationPipeline.ts` 中，在调用 `translateWordPath` 之前，对比 `routingLang` 和 `selectionLang`。

**逻辑**：
如果 `selectionClassifier` 判定为单词（Word），且 `selectionLang` != `routingLang`：
- 检查 `routingLang` 是否为常用语言（如 `en`）。
- 检查 `selectionLang` 是否为生僻误判（如 `kk`）。
- 决定是否覆盖 `selectionLang` 为 `routingLang`。

**建议采用方案 A 的变体**：
最稳健的方式是在 `languageDetector` 层面支持 `contextHint`。但在不修改底层工具函数签名的情况下，我们可以先在 `TranslationPipeline` 层面做一个简单的修正策略：

**修正策略 (TranslationPipeline Level Fix)**:
当 `routingLang` 是 `en` (英语) 且 `selectionLang` 并非其他强特征语言（如 CJK 或明确的拉丁语族变体），且选中文本较短时，倾向于信任 `routingLang`。

鉴于 "internally" 这种纯字母单词被识别为 `kk`，这显然是噪声。

### 具体实施步骤

1.  **修改 `TranslationPipeline.ts`**:
    在获取 `routingLang` 和 `selectionLang` 后，增加一个修正步骤。
    ```typescript
    let finalSourceLang = selectionLang;
    // 如果上下文是英语，且选中内容被识别为非英语，但看起来像英语（纯ASCII），则修正为英语
    if (routingLang === 'en' && selectionLang !== 'en' && /^[a-zA-Z\s.,'-]+$/.test(sanitizedText)) {
        logger.info(`[Correction] Overriding detection ${selectionLang} -> en based on context`);
        finalSourceLang = 'en';
    }
    ```
    
2.  **或者更通用的方式**:
    如果 `detectSourceLanguageAsync` 支持传入 `hint`，则更为优雅。

    ```typescript
    // src/1_content/utils/languageDetector.ts
    export async function detectSourceLanguageAsync(text: string, hintLanguage?: string): Promise<string> {
        // ... get result list ...
        // if hintLanguage is in list, boost it
    }
    ```

考虑到风险控制，建议先在 `TranslationPipeline.ts` 中针对 `en` 场景做特异性修复，因为这是当前报告的痛点。

## 5. 预期效果 (Expected Outcome)

修复后，对于英文文章中的单词 "internally"，即使 `chrome.i18n` 误报为 `kk`，由于上下文是 `en` 且单词由拉丁字母组成，系统将修正为 `en`。后端将收到 `sourceLanguage: "en"`，从而正确返回英汉词典释义和音标。
