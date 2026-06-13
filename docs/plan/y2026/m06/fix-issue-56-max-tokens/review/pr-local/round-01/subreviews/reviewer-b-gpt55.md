## Findings

### P0 (Must Block)
无。

### P1 (Must Fix)
无。

### P2 (Should Fix)
无。

### P3 (Nice to Have)
1. `[src/8_generate/constants/GenerateConstants.ts:9]` 未来模型族需要维护匹配规则
   当前正则覆盖了本次目标中的 `gpt-5*`、`o1*`、`o3*`、`o4*`，并且不会误伤 `gpt-4o`、`qwen-max`、`deepseek-chat` 等已列出的旧模型/第三方模型。不过它是显式白名单：未来如果 OpenAI 推出同样不支持 `max_tokens` 的 `gpt-6*`、`o5*` 等模型，需要同步更新该常量和测试。建议后续在常量注释或模块文档里标明“当前已知模型族”，避免误以为该规则自动覆盖所有未来新模型。

2. `[tests/8_generate/services/OpenAICompatibleClient.test.ts:73]` 可补充参数值断言
   现有测试已验证新旧参数名互斥，但没有断言传出的 token 值等于 `config.maxTokens`/默认值。当前实现实际传的是 `this.maxTokens`，没有发现错误；补充 `expect(callArg.max_completion_tokens).toBe(1200)` / `expect(callArg.max_tokens).toBe(1200)` 可以降低未来重构时只保留字段名但丢失正确值的回归风险。

## Open Questions
- OpenAI 未来模型命名（例如 `gpt-6*`、`o5*`）是否应由配置/服务端能力检测驱动，而不是继续维护前端正则白名单？本轮不影响 Issue #56 的合并判断。
- `LLMConfig.maxTokens` 省略时是否应继续使用模块默认值 `DEFAULT_MAX_TOKENS=1200`，还是按需求文档中的“未设置时不传 max_tokens”调整语义？当前代码延续了 README/类型注释中的默认值行为。

## Change Summary
- 本次变更在 8_generate 的 OpenAI-compatible client 中根据模型名前缀选择 `max_completion_tokens` 或 `max_tokens`。正则对本次目标模型（`gpt-5*`、`o1*`、`o3*`、`o4*`）匹配正确，对旧 OpenAI 模型和常见第三方模型保持原 `max_tokens` 路径；条件展开对象不会同时传入两个 token 参数，也未引入明显 SDK 类型风险。

## Residual Risks
- 已执行 `npm test -- --run tests/8_generate/services/OpenAICompatibleClient.test.ts`，12/12 通过。
- 已确认 `openai@6.15.0` 类型定义包含 `max_completion_tokens?: number | null`。
- `npm run type-check` 仍因既有问题失败：`src/2_background/services/ServiceInitializer.ts(9,65): Cannot find module '@/5_backend/config/credentials'`；该错误与本次改动文件无直接关系，但意味着本轮无法用全仓 TypeScript 检查作为最终绿灯。
- 未进行真实 OpenAI/第三方 API 联调；第三方兼容 API 是否接受或忽略 `max_completion_tokens` 仅通过模型名路由策略规避，未做端到端验证。

## Verdict: APPROVED
