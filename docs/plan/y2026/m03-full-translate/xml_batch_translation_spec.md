# 批量翻译 XML 标签化与 ID 对齐重构方案

**Date**: 2026-03-16
**Status**: Proposal
**Target Repository**: `translate-api` (服务端)

## 1. 背景与痛点

当前全文翻译模块的批量翻译 API (`/api/v1/translate/full-text-batch`) 在服务端拼接客户端传来的数组时，使用了特殊的纯字符串分隔符 `%%`：
```text
Text A %% Text B %% Text C
```
这种“古典”的 Prompt 拼接方式存在三个致命缺陷：
1. **内容碰撞风险极高**：如果用户的网页原文中正好包含 `100%%` 等代码或文本，服务端的 `split('%%')` 会彻底崩溃，导致翻译数组长度与原文不匹配。
2. **大模型丢失分隔符**：LLM 在处理长文本时，对纯符号的感知能力较弱，容易“漏件”或多加分隔符，导致数据错位。
3. **上下文边界模糊**：大模型可能会跨越 `%%` 理解上下文，导致语气和语法的串联污染。

当客户端（插件端）检测到返回的数组长度与发送的长度不一致时，会触发 `BatchCountMismatchError`，导致重试甚至放弃打包降级为单条请求，严重影响性能与用户体验。

## 2. 重构方案：XML 标签 + 唯一 ID 驱动

利用主流 LLM（如 Claude, GPT-4, Qwen）对结构化标记语言（XML/HTML）的高度敏感性，将纯字符分隔改为带 ID 的 XML 标签包裹。

### 2.1 结构设计

不改变客户端发送和接收的纯数组 JSON 结构，纯在服务端改造：

**组装阶段 (发送给 LLM 前)：**
将 `string[]` 数组映射成带有严格 `<segment id="x">` 闭合标签的 XML 结构。

```xml
<segments>
  <segment id="0">Buy this </segment>
  <segment id="1">Awesome Apple</segment>
  <segment id="2"> today for only $9.99!</segment>
</segments>
```

**提示词设计 (System Prompt)：**
> You are an expert translator. Translate the text within each `<segment>` from English to Chinese. 
> MUST maintain the exact same XML structure and IDs in your response. 
> NEVER translate or modify the XML tags themselves.
> Return ONLY valid XML without markdown code blocks.

**解析阶段 (收到 LLM 返回后)：**
放弃使用原先脆弱的 `split()`，改用正则表达式进行安全提取和按 ID 归位。

```javascript
// 核心提取逻辑伪代码
const regex = /<segment id="(\d+)">([\s\S]*?)<\/segment>/g;
let match;
const result = [];
let matchCount = 0;

while ((match = regex.exec(llmResponse)) !== null) {
    const id = parseInt(match[1], 10);
    const translatedText = match[2];
    result[id] = translatedText; // 精准锚定，不怕乱序
    matchCount++;
}

// 异常捕获：检查有效匹配数是否等于原始数组长度
if (matchCount !== originalArray.length) {
    throw new Error(`Count mismatch: Expected ${originalArray.length}, got ${matchCount}`);
}

return result;
```

## 3. 方案优势

1. **绝对防碰撞**：正常文本中几乎不可能出现 `<segment id="x">` 这种完整的自增闭合标签。即使原文含有 HTML，大模型也能清晰识别我们在外层包裹的结构。
2. **强迫症校验**：经过指令微调的大模型，看到 `<tag>` 就会强迫自己输出 `</tag>`，彻底杜绝了分隔符漏写的问题。
3. **支持乱序恢复**：引入了 `id` 属性作为锚点。即使大模型在输出时发生了乱序（例如先翻译了 ID=2，再翻译 ID=1），正则匹配后通过 `result[id]` 赋值，依然能保证最终返回给客户端的数组顺序绝对正确。

## 4. 下一步行动

1. 在 `translate-api` 仓库的 `src/7_generate/services/FullTextBatchTranslation.service.ts` 中实现此 XML 拼接和正则提取逻辑。
2. 更新对应的 `system_prompt.txt` 和 `user_prompt_template.txt`。
3. 添加包含特殊字符（如 `< > %%`）和代码段的复杂测试用例，验证提取的鲁棒性。