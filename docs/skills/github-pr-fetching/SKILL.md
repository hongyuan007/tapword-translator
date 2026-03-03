---
name: github-pr-fetching
description: Guide for fetching GitHub pull request details (metadata, review summaries, inline code comments, changed files) via gh CLI, and optionally saving structured output to a local directory.
---

# GitHub PR Fetching Guide

This skill provides a standard procedure for pulling complete PR information — including metadata, Copilot/human review summaries, inline code-level comments, and changed file lists — from GitHub using the `gh` CLI.

## When to use this skill
- When a user asks to "fetch PR #X", "read the PR comments", or "summarize PR #X".
- When you need to analyze code review feedback (inline comments) before making fixes.
- When archiving a PR for documentation or post-mortem analysis.
- When the user specifies an output path (e.g., `docs/plan/...`), save the full PR content there.

## Prerequisites
- **GitHub CLI (`gh`)**: Must be installed and authenticated (`gh auth login`).
- Always set `GH_PAGER=cat` to prevent output from opening an interactive pager.

---

## Step-by-Step Instructions

### Step 1 — Fetch PR Metadata + Review Summaries

Fetches the PR title, body, author, state, labels, general comments, and review-level summaries (e.g., Copilot's "Pull request overview").

```bash
GH_PAGER=cat gh pr view <pr-number> \
  --repo <owner>/<repo> \
  --json number,title,body,createdAt,updatedAt,author,state,labels,comments,reviews,url
```

Key fields to note:
- `title` / `body`: PR description written by the author.
- `comments`: General (non-review) conversation thread comments.
- `reviews[].body`: Review summaries (e.g., Copilot's overview). Each review also contains `author.login`, `state` (`COMMENTED`, `APPROVED`, `CHANGES_REQUESTED`), and `submittedAt`.

> **Note**: `reviews` from `gh pr view` only contain top-level review summaries, not inline code comments. See Step 2 for inline comments.

---

### Step 2 — Fetch Inline Code Review Comments

Inline comments are attached to specific lines in specific files. Use the REST API endpoint:

```bash
GH_PAGER=cat gh api repos/<owner>/<repo>/pulls/<pr-number>/comments \
  --jq '[.[] | {path: .path, line: .line, body: .body, author: .user.login, createdAt: .created_at}]'
```

This returns an array of objects with:
- `path`: The file being commented on.
- `line`: The line number in the diff.
- `body`: The comment text.
- `author`: The GitHub username of the commenter.
- `createdAt`: Timestamp.

---

### Step 3 — Fetch Changed Files List

```bash
GH_PAGER=cat gh pr view <pr-number> \
  --repo <owner>/<repo> \
  --json files \
  --jq '[.files[] | {path: .path, additions: .additions, deletions: .deletions}]'
```

---

## Saving Output to a Local Directory

**If the user specifies an output path**, create a directory and save a structured `README.md` there.

### Directory Naming Convention
```
<user-specified-path>/pr-<number>-<short-slug>/
```

### README.md Structure
Generate a `README.md` with the following sections:

```markdown
# PR #<number>: <title>

## Metadata
| Field | Value |
|-------|-------|
| Status | <state> |
| Author | <author.login> |
| Created | <createdAt> |
| Updated | <updatedAt> |
| URL | <url> |
| Labels | <labels> |

## Description
<body content, or "_(No description provided)_" if empty>

## Review Summaries
### Review by <author.login> (<state>) — <submittedAt>
<review body>

## Inline Code Comments (<N> comments)
### `<path>` (line <line>)
> <comment body>
— **<author>** at <createdAt>

...repeat for each inline comment...

## Changed Files (<N> files)
| File | +Additions | -Deletions |
|------|-----------|-----------|
| path/to/file.ts | +10 | -5 |
...
```

---

## Complete Example Workflow

**User**: "Fetch PR #26 from hongyuan007/tapword-translator and save it to `docs/plan/y2026/`."

**Agent**:

1. **Fetch PR metadata + reviews**:
   ```bash
   GH_PAGER=cat gh pr view 26 \
     --repo hongyuan007/tapword-translator \
     --json number,title,body,createdAt,updatedAt,author,state,labels,comments,reviews,url
   ```

2. **Fetch inline comments**:
   ```bash
   GH_PAGER=cat gh api repos/hongyuan007/tapword-translator/pulls/26/comments \
     --jq '[.[] | {path: .path, line: .line, body: .body, author: .user.login, createdAt: .created_at}]'
   ```

3. **Fetch changed files**:
   ```bash
   GH_PAGER=cat gh pr view 26 \
     --repo hongyuan007/tapword-translator \
     --json files \
     --jq '[.files[] | {path: .path, additions: .additions, deletions: .deletions}]'
   ```

4. **Create directory**:
   ```bash
   mkdir -p "docs/plan/y2026/m03-pr-26-v0.4.1"
   ```

5. **Write README.md**: Consolidate all fetched data into a structured `README.md` as described above.

---

## Best Practices

- **Always fetch inline comments separately** — `gh pr view` does not include them in the `comments` or `reviews` fields.
- **Disable the pager**: Always prefix commands with `GH_PAGER=cat` to avoid interactive output.
- **PR naming suggestion**: After reading the PR content, suggest a descriptive PR title to the user if the existing title is too generic (e.g., "version X.Y.Z") by summarizing the key changes from the review summary and changed files.
- **Output path**: If the user does not specify an output path, just print the summary in the chat. Only create files when a path is explicitly given.

## Troubleshooting

- **Pager opens interactive buffer**: Add `GH_PAGER=cat` before the `gh` command.
- **`gh api` returns HTML instead of JSON**: The repo may be private or your token lacks `repo` scope. Re-authenticate with `gh auth login --scopes repo`.
- **Empty `comments` array from `gh pr view`**: General comments may be absent; inline comments require the separate `gh api .../pulls/.../comments` call.
