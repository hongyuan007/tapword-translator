# Fix #56: max_tokens → max_completion_tokens — 任务拆分

## 子任务列表

### T1: 新增 NEW_MODEL_PATTERN 常量
- 范围：`src/8_generate/constants/GenerateConstants.ts`
- 依赖：无
- 验收：正则 `/^(gpt-5|o[134])/i` 导出，支持大小写
- 状态：✅ 完成

### T2: 修改 OpenAICompatibleClient.generate() 条件参数
- 范围：`src/8_generate/services/llm/OpenAICompatibleClient.ts`
- 依赖：T1
- 验收：新模型传 `max_completion_tokens`，旧模型传 `max_tokens`，使用展开运算符
- 状态：✅ 完成

### T3: 编写核心测试（8 个用例）
- 范围：`tests/8_generate/services/OpenAICompatibleClient.test.ts`
- 依赖：无（TDD 先行）
- 验收：覆盖 gpt-5/gpt-5.4-nano/o1/o3-mini（新模型）+ gpt-4o/gpt-4o-mini/qwen-max/deepseek-chat（旧模型）
- 状态：✅ 完成

### T4: 补充边界测试（4 个用例）
- 范围：`tests/8_generate/services/OpenAICompatibleClient.test.ts`
- 依赖：T2
- 验收：覆盖未知模型名默认行为、大小写敏感性（GPT-5/O1）、空模型名防护
- 状态：✅ 完成
