# 分支 & PR 规则

## 分支命名

```
feature/issue-<issue-number>-<short-name>
fix/issue-<issue-number>-<short-name>
```

示例：
- `feature/issue-23-zh-tw-support`
- `fix/issue-22-network-translation-fail`

## Commit Message 格式

```
<type>: <description>

Closes #<issue-number>
```

type 取值：
- `feat`: 新功能
- `fix`: bug 修复
- `refactor`: 重构
- `docs`: 文档
- `style`: 样式
- `chore`: 构建/配置

示例：
```
feat: add Traditional Chinese (zh-TW) as translation target language

Closes #23
```

## PR 创建规则

### 标题格式
```
<type>: <description>
```

### Body 模板
```markdown
## Summary
Closes #<issue-number>

<一句话描述这个 PR 做了什么>

## Changes
- <bullet list of changes>

## Testing
- Type-check: ✅/❌
- Unit tests: ✅/❌
- Code review: ✅/❌ (0 Must Fix, N Nice-to-Have)
- Verification: ✅/❌

## Spec & Review Docs
- Spec: `docs/plan/y2026/<TaskID>/analysis/<spec-file>.md`
- Review Report: `docs/plan/y2026/<TaskID>/review/<report-file>.md`
```

### 基分支
- 默认 `main`
- 如果 issue 涉及特定版本分支，按需调整

## 跨仓库 PR

如果一个 issue 涉及多个仓库：
1. 在每个仓库分别创建分支
2. 分别 commit 和 push
3. 分别创建 PR
4. PR 之间用 "Related to #<issue-number>" 关联
5. PR body 中列出关联的跨仓库 PR

## PR 提交命令

```bash
# tapword-translator
cd /home/coer/project/tapword-translator
git checkout main
git pull
git checkout -b <branch-name>
git add -A
git commit -m "<commit-message>"
git push -u origin <branch-name>
gh pr create --title "<title>" --body-file /tmp/pr-body.md --base main

# translate-api（如需要）
cd /home/coer/project/translate-api
# 同上流程

# plugin-web（如需要）
cd /home/coer/project/plugin-web
# 同上流程
```

## 注意事项

- 创建分支前先 `git pull` 确保基于最新 main
- 提交前确认工作区干净（`git status`）
- 如果有冲突，先解决再提交
- PR 创建后确认链接可用
