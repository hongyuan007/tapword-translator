# Fix #56: OpenAI 新模型不再接受 max_tokens

## 背景

OpenAI 在新一代模型（o1、o3、gpt-5.x 系列）中废弃了 `max_tokens` 参数，替换为 `max_completion_tokens`。tapword-translator 的 `OpenAICompatibleClient` 在调用 API 时硬编码使用 `max_tokens`（snake_case），导致用户选择 gpt-5.4-nano 等新模型时请求直接报错，插件无法使用。

**Issue**: #56 — `[BUG] openai新的模型不再接受 max_tokens，现在插件用不了新的模型`
**提交者**: hongyuan007 (Eric Zhang)
**环境**: Extension Version 0.4.5
**复现**: 自定义 API + gpt-5.4-nano → API 返回参数错误

## 目标

让 `OpenAICompatibleClient` 在调用不支持 `max_tokens` 的模型时，不传该参数（或使用新参数名），同时保证旧模型和第三方兼容 API 的行为不受影响。

## 范围

### 包含
- `src/8_generate/services/llm/OpenAICompatibleClient.ts` — API 调用参数逻辑
- 可能涉及 `src/8_generate/types/GenerateTypes.ts` — 类型定义扩展（如需新增模型判断字段）
- 可能涉及 `src/8_generate/constants/GenerateConstants.ts` — 常量定义

### 不包含
- UI/设置页面改动（用户当前无法自定义 maxTokens，此次也不新增该能力）
- 其他 LLM Client（项目中仅此一个）
- OpenAI SDK 版本升级（除非必要）

## 用户场景

### 场景 1：新模型用户（gpt-5.x 系列）
1. 用户在设置中配置自定义 API，填入 gpt-5.4-nano 作为模型
2. 在网页上选词触发翻译
3. **期望**：翻译正常返回结果，不报错

### 场景 2：旧模型用户（gpt-4o 等）
1. 用户使用 gpt-4o 等旧模型
2. 选词触发翻译
3. **期望**：行为与之前完全一致，`max_tokens` 正常传递

### 场景 3：第三方兼容 API 用户（Qwen、DeepSeek 等）
1. 用户使用第三方 OpenAI 兼容 API
2. 选词触发翻译
3. **期望**：不受此次改动影响，正常工作

## 验收标准

- [ ] 调用 GPT-5.x 系列新模型时，请求体中不包含 `max_tokens` 字段
- [ ] 调用旧模型（gpt-4o 等）时，`max_tokens` 正常传递，行为不变
- [ ] LLMConfig 中 `maxTokens` 为空/未设置时，不传 `max_tokens`
- [ ] 所有已有测试通过，无回归
- [ ] 构建成功（`npm run build` + `npm run type-check`）

## 关联信息

- **Issue**: https://github.com/TapWord/tapword-translator/issues/56
- **分支**: `fix/issue-56-max-tokens`
- **问题根因**: `OpenAICompatibleClient.ts` L64 `max_tokens: this.maxTokens`
- **数据流**: `CUSTOM_API_FIXED_PARAMS.maxTokens (1200)` → `LLMConfig.maxTokens` → `OpenAICompatibleClient.maxTokens` → API 请求 `max_tokens` 字段
