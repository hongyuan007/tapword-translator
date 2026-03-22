# Auto GitHub Issue Worker — Cron Checklist

## 检查频率
每 3 小时执行一次

## 检查逻辑（每次触发时执行）

### Step 1: 检查当前任务状态
- 读取 `docs/plan/y2026/` 下的最新任务目录
- 读取 `progress.md` 确认当前任务进度

### Step 2: 检查代码状态
- `git log --oneline -5` — 确认最新 commit
- `git status` — 确认工作区干净
- `git branch -r` — 确认远程分支存在

### Step 3: 检查 PR 状态
- `gh pr list --head <branch>` — 确认 PR 已提交
- `gh pr view <pr-number> --json state,mergeable` — 确认 PR 状态

### Step 4: 判断 & 行动
- **如果当前任务全部完成（PR 已提交且 mergeable）**：
  - 从 Open Issues 中选下一个简单 issue（优先级：bug > enhancement，跳过需要架构决策的）
  - 启动完整流程：Research → Implement → Verify → Review → Push → PR
  - 每个阶段用独立 subagent
- **如果当前任务未完成**：
  - 向老板汇报当前进度和卡点
- **如果当前任务卡住（验证失败超过 2 轮）**：
  - 向老板汇报，请求人工介入

## 选 Issue 规则（自动，不需要老板决策）
1. 优先 bug（影响用户体验）
2. 其次 enhancement（明确scope的）
3. 跳过以下类型（需要人工决策）：
   - 涉及新平台支持（Safari、移动端Firefox）
   - 涉及架构重构
   - 涉及付费/API密钥变更
   - Issue 评论中有争议或需求不明确

## Issue 排队池（当前）
按之前评估的难度排序：
1. ~~#23 繁体中文支持~~ ✅ PR #51
2. #22 网络翻译失败（排查）
3. #31 自定义图标位置
4. #41 句子范围识别优化
5. #36 Firefox文本错位

## 仓库路径（所有 subagent 都需要知道）
- **前端（Chrome 扩展）**: `/home/coer/project/tapword-translator` — GitHub: `hongyuan007/tapword-translator`
- **后端（翻译 API）**: `/home/coer/project/translate-api` — GitHub: `hongyuan007/translate-api`
- **网站（官网/Web）**: `/home/coer/project/plugin-web` — GitHub: `hongyuan007/plugin-web`

## Subagent 上下文规则
- 每个 subagent prompt 必须列出相关的仓库路径
- 如果 issue 涉及前后端联动（如新增翻译语言），subagent 需要同时访问前端和后端仓库
- 如果 issue 涉及官网展示（如新增功能介绍页面），subagent 需要访问 plugin-web 仓库
- subagent 的 prompt 要明确标注哪些仓库需要读/写

## Subagent 模板
使用 `docs/prompt_files/agent/subagent.prompt.md` 和 `codex-orchestrator.system.prompt.md` 中的 Workflow A（Standard）流程。
