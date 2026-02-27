---
name: github-issue-fetching
description: Guide for fetching GitHub issues, downloading images, and creating a local reproduction or analysis directory.
---

# GitHub Issue Fetching Guide

This skill provides a standard procedure for downloading GitHub issues, including their metadata, body content, and attached images, into a local directory for analysis or reproduction.

## When to use this skill
- When a user asks to "fetch issue #X" or "download issue details".
- When you need to analyze a reported bug offline or create a reproduction case based on user reports.
- When archiving issue content for documentation or future reference.

## Prerequisites
- **GitHub CLI (`gh`)**: Must be installed and authenticated (`gh auth login`).
- **cURL**: Used for downloading images.

## Step-by-Step Instructions

### 1. Create a Dedicated Directory
Create a directory to store the issue data. Use a descriptive name including the issue number and month prefix.
```bash
mkdir -p "docs/plan/y<year>/m<month>-issue-<number>-<description>"
```

### 2. Fetch Issue Metadata
Use `gh` to fetch comprehensive issue details in JSON format. This includes title, body, author, comments, labels, and state.
```bash
gh issue view <issue-number> --repo <owner>/<repo> --json number,title,body,createdAt,updatedAt,author,state,comments,labels,assignees,milestone,url > issue.json
```

### 3. Parse and Download Attachments
Analyze the `body` field (and `body` field within `comments` array) in `issue.json` to find image URLs. These are typically in Markdown (`![alt](url)`) or HTML (`<img src="url">`) format.
Use `curl` to download each image locally.
```bash
# Use -L to follow redirects. Add -k if you encounter SSL errors.
curl -L -k -o screenshot-1.png "<image-url>"
```

### 4. Generate Markdown Summary
Create a `README.md` file in the directory that reconstructs the issue content.
- Use the issue title and number as the H1 header.
- Include metadata table (Status, Author, Date, Labels, URL).
- Insert the issue body.
- Append a section for Comments, iterating through each comment with its author and date.
- Replace remote image URLs with local relative paths (e.g., `./screenshot-1.png`) in both body and comments.

## Example Workflow (Agent Interaction)

**User**: "Fetch issue #20 from hongyuan007/tapword-translator."

**Agent**:
1.  **Creates directory**: `mkdir -p "docs/plan/y2026/m02-issue-20-youtube-title-bug"`
2.  **Fetches JSON**: `gh issue view 20 ... > issue.json`
3.  **Reads JSON**: Parses `issue.json` to extract `body` and find image URLs.
4.  **Downloads Images**: Runs `curl` for each image found.
5.  **Writes Summary**: Creates `README.md` with the issue content and local image references.

## Best Practices
- **Directory Naming**: Use a consistent naming convention like `issue-<number>-<short-slug>`.
- **Image Naming**: Rename downloaded images sequentially (e.g., `screenshot-1.png`, `screenshot-2.png`) for clarity.
- **Privacy**: Be mindful of sensitive data in screenshots or logs within the issue.

## Troubleshooting
- **SSL Errors**: If `curl` fails with SSL errors (e.g., `SSL_ERROR_SYSCALL`), verify you are using the `-k` (insecure) flag.
- **Directory Access**: Use absolute paths (`/Users/.../docs/plan/...`) when creating directories or moving files to ensure reliability across terminal sessions.

