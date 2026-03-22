# Subagent Prompt 模板

以下是各阶段 subagent 的 prompt 模板。主 agent 在调用 `sessions_spawn` 时，根据模板填入具体参数。

## 通用规则

- `mode=run`（同步阻塞，等结果）
- `cwd` 设为主要修改的仓库路径
- 不使用 `sessions_yield`
- 每个 subagent 只做一个阶段的任务

---

## Template A — Research（研究 + 规格文档）

```
TASK: Research codebase and write a technical spec.

CONTEXT FILES:
- AGENTS.md
- docs/prompt_files/code_style/core.md
- docs/plan/y2026/<TaskID>/progress.md
- [相关仓库的 AGENTS.md，如果是跨仓库任务]

TASK DESCRIPTION:
[用技术语言描述需求，不要原文转发 issue 内容]

INSTRUCTIONS:
1. Analyze the request and existing code patterns.
2. Create a Spec Document at: docs/plan/y2026/<TaskID>/analysis/YYMMDD_HHMM_<subject>.md
   The spec must include:
   - Current State Analysis
   - Proposed Changes (Files & Logic)
   - Risks / Edge Cases
   - Verification Plan
3. Do NOT write implementation code yet.

RETURN: Summary of findings + Exact path to Spec File.
```

---

## Template B — Implementation（实现）→ 使用 Codex ACP

**调用方式**: `sessions_spawn(runtime="acp", agentId="codex", cwd=<repo-path>, mode="run")`

⚠️ 重要：Implementation 阶段使用 Codex（ACP 模式），不是通用 subagent。Codex 直接在项目目录下工作，擅长读写代码、跑构建。

```
TASK: Implement changes based on the provided Spec.

CONTEXT FILES:
- AGENTS.md（项目规则和构建命令）
- docs/prompt_files/code_style/core.md（代码风格规范）
- docs/plan/y2026/<TaskID>/progress.md（进度文件）
- <Spec File Path from Phase 1>（规格文档，source of truth）

SPEC 要点（从 spec 文件中提取关键信息写入这里，不要让 Codex 自己去找文件）：
- Current State: <现状描述>
- Proposed Changes: <需要改的文件和逻辑>
- Key Constraints: <关键约束>

INSTRUCTIONS:
1. Read the Spec Document at <Spec File Path>.
2. Implement ALL code changes strictly following code_style/core.md.
3. After implementation, run `npm run type-check` to verify no new errors.
4. Update docs/plan/y2026/<TaskID>/progress.md — mark Phase 2 as complete, list files changed.
5. Do NOT run full test suite (Verification Agent will do this).
6. Do NOT create git commits or push (Orchestrator will handle git operations).

RETURN: List of modified files + Exact path to updated progress.md + Type-check result (pass/fail).
```

### Codex 调用示例

```python
sessions_spawn(
    runtime="acp",
    agentId="codex",
    cwd="/home/coer/project/tapword-translator",
    mode="run",
    task="<Template B 的完整 prompt>"
)
```

### 跨仓库场景

如果 issue 涉及多个仓库，按顺序启动多个 Codex 实例：
1. 先改后端（translate-api）→ 等 Codex 完成
2. 再改前端（tapword-translator）→ 等 Codex 完成
3. 最后改网站（plugin-web）→ 如果需要

---

## Template C — Review（代码审查）

```
TASK: Perform a structured code review.

CONTEXT FILES:
- AGENTS.md
- docs/prompt_files/review/project-review-rule.prompt.md
- docs/prompt_files/review/generate-review-manifest.prompt.md

MODIFIED FILES:
- [List of modified files]

INSTRUCTIONS:
1. Read the review guidelines in project-review-rule.prompt.md.
2. Inspect all modified files for:
   - Architectural soundness
   - Code quality and style consistency
   - Security concerns
   - Maintainability
3. Identify issues as "Must Fix" vs "Nice to Have".
4. Write a Review Report at: docs/plan/y2026/<TaskID>/review/YYMMDD_HHMM_report.md.

RETURN: Summary of findings (Must Fix / Nice to Have) + Exact path to Report.
```

---

## Template D — Verification（验证）

```
TASK: Verify recent changes, check logic, and run build commands.

CONTEXT FILES:
- AGENTS.md
- docs/plan/y2026/<TaskID>/progress.md
- <Spec File Path>

MODIFIED FILES:
- [List of modified files]

INSTRUCTIONS:
1. LOGIC CHECK:
   - Inspect the modified files.
   - Confirm the requested changes are present.
   - Check for obvious regressions.

2. BUILD & TEST:
   - See AGENTS.md for available build/test commands.
   - Run the project's type-checker.
   - Run the project's linter (if applicable).
   - Run relevant unit tests for the modified module.

3. REPORTING:
   - If ALL PASS: Return "VERIFICATION PASSED".
   - If FAIL: Return "VERIFICATION FAILED" with specific error logs.

RETURN: Pass/Fail Status + Execution Logs.
```

---

## Template E — Quick Fix（快速修复，仅用于简单任务）

```
TASK: Analyze and implement a simple fix immediately.

CONTEXT FILES:
- AGENTS.md
- docs/prompt_files/code_style/core.md
- [Target Source Files]

INSTRUCTIONS:
1. SAFETY FIRST: If the task is actually complex, ABORT. Return "ABORT: COMPLEX_TASK".
2. IMPLEMENT: Apply the fix directly. Adhere to code_style/core.md.
3. SELF-CORRECT: Double-check your own syntax before finishing.
4. RECORD: Update docs/plan/y2026/<TaskID>/progress.md.

RETURN: Status (SUCCESS / ABORT) + List of files modified + Brief summary of LOGIC changed.
```

---

## 任务目录结构

| 类型 | 路径模式 |
|---|---|
| 任务根目录 | `docs/plan/y2026/<TaskID>/` |
| Spec 文档 | `.../analysis/YYMMDD_HHMM_title.md` |
| Review 报告 | `.../review/YYMMDD_HHMM_report.md` |
| 进度追踪 | `.../progress.md` |

**Task ID 格式**: `mMM-short-name`（如 `m03-zh-tw-support`、`m03-network-fail`）

## Workflow 选择

- **Workflow A（Standard）**: >2 文件可能改动、scope 不明确、涉及共享抽象 → Research → Implement → Verify → Review
- **Workflow B（Fast Track）**: 配置变更、typo、CSS tweak → Quick Fix → 如果涉及逻辑则补 Verify
