# GitHub Issue Worker Prompt

主 Prompt：
- `github_issue_worker.md`

参考文档：
- `references/issue_selection_rules.md` — Issue 自动选择/排除规则和排队池
- `references/repo_paths.md` — 所有仓库的本地路径和 GitHub 地址
- `references/sub_agent_templates.md` — 各阶段 subagent 的 prompt 模板（A/B/C/D/E）
- `references/branch_pr_rules.md` — 分支命名、commit message、PR 创建规范

用途：
- 让定时任务（cron）的 isolated agent 自动检查 Issue 进度
- 选择下一个合适的 issue
- 通过 subagent 完成完整的 Research → Implement → Verify → Review → Push → PR 流程
- 向 Discord 频道汇报结果

使用方式：
- cron job 的 message 字段引用此文件路径：
  `docs/prompt_files/github_issue_worker/github_issue_worker.md`
- 同时告知 agent 读取 `references/` 下的所有参考文档
