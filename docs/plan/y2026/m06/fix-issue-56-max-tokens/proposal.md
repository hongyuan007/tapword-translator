# Fix #56: OpenAI 新模型不再接受 max_tokens — 技术方案

## 现状分析

### 问题根因

`OpenAICompatibleClient.generate()` 方法（L64）在构造 API 请求时硬编码使用 `max_tokens`：

```typescript
const completion = await this.client.chat.completions.create({
    model: this.model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: this.temperature,
    max_tokens: this.maxTokens,          // ← 问题根因
    response_format: { type: "json_object" },
})
```

### 数据流

```
CUSTOM_API_FIXED_PARAMS.maxTokens (1200)  ← src/0_common/constants/customApi.ts
    ↓
LLMConfig.maxTokens                        ← src/8_generate/types/GenerateTypes.ts
    ↓
OpenAICompatibleClient.maxTokens           ← constructor fallback DEFAULT_MAX_TOKENS (1200)
    ↓
API 请求体 max_tokens: this.maxTokens      ← generate() L64
```

**关键发现**：`maxTokens` 始终被设置为 1200，没有任何代码路径会让它为空。

### 受影响模型

OpenAI 在以下新模型中废弃了 `max_tokens`，替换为 `max_completion_tokens`：

| 模型系列 | 示例 |
|----------|------|
| gpt-5.x | gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.4-nano |
| o 系列 | o1, o1-mini, o3, o3-mini, o3-pro, o4-mini |

调用新模型时传 `max_tokens` 会返回：
```
Unsupported parameter: 'max_tokens' is not supported with this model.
Use 'max_completion_tokens' instead.
```

### 第三方兼容 API

| 提供商 | max_tokens | max_completion_tokens |
|--------|-----------|----------------------|
| DeepSeek | ✅ | ❓ 未文档化 |
| Qwen | ✅ | ❓ 未文档化 |
| Moonshot | ✅ | ❓ 未文档化 |
| Zhipu | ✅ | ❓ 未文档化 |
| Groq | ✅ | ❓ 未文档化 |

`max_tokens` 是事实上的行业标准参数名，第三方 API 普遍支持。

### 运行环境

- OpenAI SDK 版本：`openai@6.15.0`（完全支持 `max_completion_tokens`）
- 项目无现有单元测试覆盖 OpenAICompatibleClient

## 方案对比

| 方案 | 优点 | 缺点 | 改动范围 |
|------|------|------|----------|
| **A. 新模型不传 max_tokens** | 改动最小；不影响旧模型和第三方 API | 新模型无法控制输出长度；需维护模型匹配规则 | 单文件 |
| **B. 新模型映射为 max_completion_tokens** | 保留 token 限制意图；符合 OpenAI 官方迁移路径；旧模型和第三方 API 零影响 | 需维护模型匹配规则 | 单文件 |
| **C. maxTokens 为空时不传** | 逻辑简单 | maxTokens 始终为 1200，需改多处调用链才生效；旧模型也失去限制 | 多文件 |
| **D. 完全不传 max_tokens** | 改动最简单（删一行） | 旧模型和第三方 API 都失去 token 限制；费用风险 | 单文件 |

## 选定方案：B — 模型名检测，映射为 max_completion_tokens

### 选择理由

1. **保留 token 限制意图**：原设计 1200 token 上限对翻译场景合理，方案 B 通过 `max_completion_tokens` 保留
2. **OpenAI 官方迁移路径**：使用 `max_completion_tokens` 是官方推荐的参数迁移方式
3. **旧模型和第三方 API 零影响**：非新模型继续使用 `max_tokens`，行为完全不变
4. **SDK 已支持**：`openai@6.15.0` 的 TypeScript 类型定义已包含 `max_completion_tokens`

### 模型检测规则

```typescript
// 新模型：gpt-5*、o1*、o3*、o4*
const NEW_MODEL_PATTERN = /^(gpt-5|o[134])/
```

- 前缀匹配，覆盖所有变体（gpt-5.4-nano、o1-mini、o3-pro 等）
- 提取为 `GenerateConstants.ts` 中的常量，便于后续维护

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/8_generate/constants/GenerateConstants.ts` | 新增 `NEW_MODEL_PATTERN` 正则常量 |
| `src/8_generate/services/llm/OpenAICompatibleClient.ts` | `generate()` 方法中根据模型名选择 `max_tokens` 或 `max_completion_tokens` |

### 不涉及
- 类型定义变更（`max_completion_tokens` 已在 OpenAI SDK 类型中）
- UI / 设置页面改动
- 其他 LLM Client（项目中仅此一个）

## 风险评估

| 风险 | 可能性 | 影响 | 应对 |
|------|--------|------|------|
| 新模型正则遗漏未来模型 | 中 | 新模型报错 | 使用宽泛前缀匹配；常量化便于更新 |
| 第三方 API 转发新模型但不认 `max_completion_tokens` | 低 | 第三方新模型报错 | 第三方通常有自己的模型名（非 gpt-5*），不会被匹配到 |
| OpenAI SDK 类型不支持 `max_completion_tokens` | 极低 | TS 编译报错 | 已确认 v6.15.0 支持 |

## 验证计划

1. **单元测试（TDD）**：mock OpenAI client，验证：
   - 新模型（gpt-5*）请求体包含 `max_completion_tokens`，不包含 `max_tokens`
   - 旧模型（gpt-4o）请求体包含 `max_tokens`，不包含 `max_completion_tokens`
   - o 系列（o1、o3）正确匹配为新模型
   - 第三方模型名（qwen-max、deepseek-chat）走旧模型路径
2. **构建验证**：`npm run type-check` + `npm run build` 通过
3. **回归验证**：已有测试全部通过
