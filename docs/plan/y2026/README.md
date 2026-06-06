# y2026 Planning Docs Convention

This directory stores planning, issue analysis, implementation notes, and review artifacts for 2026 work.

## Goal

Keep documents grouped by **requirement / issue / feature / PR topic**, not scattered directly under `docs/plan/y2026/`.

## Directory Naming

Prefer one topic directory per work item:

- `m02-issue-24-mixed-language-page-translation-bug`
- `m03-auto-translate`
- `m03-token-prefetch`
- `pr-17`

Recommended pattern:

- `mMM-issue-<id>-<slug>` for issue-driven work
- `mMM-<feature-slug>` for feature / initiative work
- `mMM-release-<version>` for release notes or release-specific review
- `pr-<id>-<slug>` for PR-focused review threads

Where:

- `mMM` = month marker in 2026, e.g. `m02`, `m03`
- `slug` = short kebab-case description

## What Should Stay at Year Root

Allowed at `docs/plan/y2026/` root:

- this `README.md`
- topic directories only

Avoid placing loose files directly under the year root.

## Recommended Topic Structure

Not every topic needs every file, but prefer this shape when applicable:

```text
docs/plan/y2026/<topic>/
  README.md              # summary, scope, current status
  issue.json             # source issue metadata when relevant
  plan.md                # implementation or fix plan
  progress.md            # working progress notes
  analysis/              # deeper technical analysis
  review/                # review manifests / review reports
  images/                # screenshots, diagrams
  logs/                  # debugging logs or captured traces
```

## File Naming

Prefer descriptive English kebab-case file names:

- `plan.md`
- `progress.md`
- `backend-api.md`
- `review-report.md`
- `images/screenshot-1.png`
- `logs/content-script.log.txt`

If older Chinese file names already exist, they may remain temporarily, but new files should prefer the convention above.

## Linking Rules

When documents reference other planning docs:

- prefer the full repo-relative path for clarity, e.g.
  - `docs/plan/y2026/m03-auto-translate/automatic-word-phrase-translation-final.md`
- update links when files are moved

## Migration Rule

When you find loose files under `docs/plan/y2026/`:

1. create or identify the correct topic directory
2. move related files together
3. move screenshots into `images/`
4. move logs into `logs/`
5. fix internal links after moving

## Practical Rule of Thumb

If a document answers "which requirement / bug / PR does this belong to?", it should usually live inside that topic directory — not at the year root.
