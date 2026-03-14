---
name: github-operations
description: Comprehensive guide for all common GitHub operations via gh CLI: fetching issues and PRs, creating PRs, pushing branches, listing and filtering, and managing PR lifecycle. Use this when performing any GitHub task beyond basic git commands.
---

# GitHub Operations Guide

A single reference for all common GitHub operations in this project using the `gh` CLI.

## When to use this skill
- Fetching issue or PR details for analysis
- Creating a new pull request after pushing a branch
- Checking PR review status or CI check results
- Listing open issues or PRs
- Any GitHub operation beyond local `git` commands

## Prerequisites

```bash
# Install and authenticate (one-time)
gh auth login

# ALWAYS prefix gh commands with this to prevent interactive pager
export GH_PAGER=cat
```

Project defaults:
- **Repo**: `hongyuan007/tapword-translator`
- **Release target branch**: `release/0.4.2`
- **Branch naming**: `fix/YYMMDD/topic` or `feat/YYMMDD/topic`


## 1. Push a Branch (first time)

New branches have no upstream; always use the explicit form:

```bash
git push origin <branch-name>
# or set upstream so bare `git push` works afterward:
git push --set-upstream origin <branch-name>
```

To configure git to auto-track all new branches globally:
```bash
git config --global push.autoSetupRemote true
```


## 2. Create a Pull Request

```bash
GH_PAGER=cat gh pr create \
  --repo hongyuan007/tapword-translator \
  --base release/0.4.2 \
  --head <your-branch> \
  --title "<type>(<scope>): <short description>" \
  --body "<PR body>"
```

**PR title conventions** (follow Conventional Commits):
- `fix(scope): description` for bug fixes
- `feat(scope): description` for new features
- `docs(scope): description` for documentation

**PR body checklist** (include in body):
- Problem statement
- Root cause (if bug fix)
- Summary of changes per file
- Edge cases considered
- How to test / verify

Returns the PR URL on success.


## 3. Fetch Issue Details

```bash
GH_PAGER=cat gh issue view <issue-number> \
  --repo hongyuan007/tapword-translator \
  --json number,title,body,createdAt,updatedAt,author,state,comments,labels,assignees,url
```

To save locally for analysis:
```bash
gh issue view <number> --repo hongyuan007/tapword-translator \
  --json number,title,body,createdAt,updatedAt,author,state,comments,labels,url \
  > docs/plan/y2026/m<MM>-issue-<number>-<slug>/issue.json
```

Download images from the issue body:
```bash
wget -O screenshot-1.png "<image-url-from-issue-body>"
```


## 4. Fetch PR Details (Full)

### 4.1 Metadata + Review Summaries

```bash
GH_PAGER=cat gh pr view <pr-number> \
  --repo hongyuan007/tapword-translator \
  --json number,title,body,createdAt,updatedAt,author,state,labels,comments,reviews,url
```

Key fields:
- `reviews[].body` — top-level review summaries (Copilot overview, etc.)
- `reviews[].state` — `COMMENTED` | `APPROVED` | `CHANGES_REQUESTED`
- `comments` — general conversation (not inline code comments)

### 4.2 Inline Code Review Comments

> `gh pr view` does NOT include inline code comments. Use the REST API:

```bash
GH_PAGER=cat gh api repos/hongyuan007/tapword-translator/pulls/<pr-number>/comments \
  --jq '[.[] | {path: .path, line: .line, body: .body, author: .user.login, createdAt: .created_at}]'
```

### 4.3 Changed Files

```bash
GH_PAGER=cat gh pr view <pr-number> \
  --repo hongyuan007/tapword-translator \
  --json files \
  --jq '[.files[] | {path: .path, additions: .additions, deletions: .deletions}]'
```

### 4.4 CI Check Runs

```bash
GH_PAGER=cat gh pr checks <pr-number> --repo hongyuan007/tapword-translator
```


## 5. List Issues / PRs

```bash
# List open issues
GH_PAGER=cat gh issue list --repo hongyuan007/tapword-translator --state open

# List open PRs
GH_PAGER=cat gh pr list --repo hongyuan007/tapword-translator --state open

# Filter by label
GH_PAGER=cat gh issue list --repo hongyuan007/tapword-translator --label "bug"

# Filter PRs by base branch
GH_PAGER=cat gh pr list --repo hongyuan007/tapword-translator --base release/0.4.2
```


## 6. Check PR / Issue Status

```bash
# View PR status (CI, reviews, merge state)
GH_PAGER=cat gh pr view <pr-number> --repo hongyuan007/tapword-translator

# View issue status
GH_PAGER=cat gh issue view <issue-number> --repo hongyuan007/tapword-translator
```

## 7. Close / Merge / Comment

```bash
# Merge a PR (squash)
GH_PAGER=cat gh pr merge <pr-number> --repo hongyuan007/tapword-translator --squash

# Close an issue
GH_PAGER=cat gh issue close <issue-number> --repo hongyuan007/tapword-translator

# Add a comment to an issue or PR
GH_PAGER=cat gh issue comment <issue-number> --repo hongyuan007/tapword-translator --body "Comment text"
GH_PAGER=cat gh pr comment <pr-number> --repo hongyuan007/tapword-translator --body "Comment text"
```


## 8. Saving PR/Issue to Local Directory

Use this pattern for archiving or analysis:

```
docs/plan/y<YEAR>/m<MM>-issue-<number>-<slug>/
  issue.json         # raw API response
  README.md          # human-readable summary
  screenshot-1.png   # downloaded images
```

### README.md structure

```markdown
# Issue/PR #<N>: <title>

## Metadata
| Field | Value |
|-------|-------|
| Status | <state> |
| Author | <login> |
| URL | <url> |

## Description
<body>

## Comments / Reviews
### <author> — <date>
<body>

## Changed Files (PRs only)
| File | +Add | -Del |
|------|------|------|
```

## Best Practices

- **Always use `GH_PAGER=cat`** — prevents output from opening an interactive pager
- **Explicit `--repo` flag** — prevents operating on the wrong repo if CWD differs
- **Push branch before `gh pr create`** — the branch must exist on remote first
- **Use `--jq` for large JSON** — filter fields immediately rather than parsing full output
- **Inline comments need REST API** — `gh pr view` only returns top-level review summaries


## Troubleshooting

| Symptom | Fix |
|---|---|
| `git push` fails with "no upstream branch" | Use `git push origin <branch>` or `git push --set-upstream origin <branch>` |
| Pager opens interactive buffer | Prefix command with `GH_PAGER=cat` |
| `gh api` returns HTML | Token lacks `repo` scope → `gh auth login --scopes repo` |
| `comments` array is empty from `gh pr view` | Inline comments need separate REST API call (Section 4.2) |
| `gh pr create` says branch not found | Push the branch first: `git push origin <branch>` |
