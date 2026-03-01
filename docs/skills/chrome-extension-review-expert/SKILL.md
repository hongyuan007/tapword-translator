---
name: chrome-extension-review-expert
description: "Expert code review for Chrome Extensions (Manifest V3). Detects MV3 violations, security risks, performance issues, and architectural anti-patterns."
---

# Chrome Extension Review Expert

## Overview

Perform a structured review of the current git changes with a specific focus on Chrome Extension (Manifest V3) constraints, security (CSP, message passing), and performance.

## Severity Levels

| Level | Name | Description | Action |
|-------|------|-------------|--------|
| **P0** | Critical | Security vulnerability (XSS, Message Spoofing), MV3 Violation (will be rejected by Store), Data Loss | Must block merge |
| **P1** | High | Service Worker lifecycle issues, significant performance regression, broken core functionality | Should fix before merge |
| **P2** | Medium | Code smell, storage quota risk, minor UI/UX glitch | Fix in this PR or create follow-up |
| **P3** | Low | Style, naming, minor optimization | Optional improvement |

## Workflow

### 1) Preflight context

- Use `git status -sb`, `git diff --stat`, and `git diff` to scope changes.
- Identify affected areas: `manifest.json`, `background` (Service Worker), `content` scripts, `popup`, `offscreen`.
- Check for changes in `manifest.json` specifically regarding `permissions` and `host_permissions`.

### 2) Manifest V3 & Architecture Compliance

- Load `references/mv3-checklist.md`.
- **Service Worker Lifecycle**: Ensure no reliance on persistent global variables in background scripts. Check for proper event listener registration (must be synchronous at top level).
- **DOM Access**: Ensure no DOM access in background scripts (use Offscreen Documents if needed).
- **Timer APIs**: Check for `setInterval`/`setTimeout` usage in background (should use `chrome.alarms`).
- **Remote Code**: Ensure no remote code execution (Remotely Hosted Code is banned in MV3).

### 3) Extension Security Scan

- Load `references/extension-security-checklist.md`.
- **Message Passing**: Verify `sender.id` and `sender.url` checks in `runtime.onMessage` listeners.
- **Content Scripts**: Check for `innerHTML` usage (XSS risk) and isolation leaks.
- **Permissions**: Verify `permissions` are least-privilege.
- **CSP**: Check `content_security_policy` changes.
- **External Connections**: Review `externally_connectable` configuration.

### 4) Performance & Resource Usage

- Load `references/extension-performance-checklist.md`.
- **Storage**: Check `chrome.storage.sync` quota usage (limits are strict).
- **Memory**: Check for memory leaks in long-lived content scripts.
- **CPU**: Identify heavy operations blocking the main thread in Popup or Content Scripts.
- **Network**: excessive polling or large payload transfers.

### 5) Code Quality & Best Practices

- Load `references/extension-architecture-checklist.md`.
- **Error Handling**: Check `chrome.runtime.lastError` handling.
- **Async/Await**: Ensure proper handling of Chrome's callback/promise APIs.
- **Project Structure**: Verify adherence to project folder structure (`src/1_content`, `src/2_background`, etc.).

### 6) Output format

Structure your review as follows:

```markdown
## Chrome Extension Review Summary

**Files reviewed**: X files, Y lines changed
**Context**: [Background / Content / Popup / Manifest / Shared]
**Overall assessment**: [APPROVE / REQUEST_CHANGES / COMMENT]

---

## Findings

### P0 - Critical
(none or list)

### P1 - High
1. **[file:line]** Brief title
  - Description of issue (e.g., "Global state in Service Worker will be lost")
  - Suggested fix

### P2 - Medium
2. (continue numbering across sections)
  - ...

### P3 - Low
...

---

## Removal/Iteration Plan
(if applicable)

## Additional Suggestions
(optional improvements, not blocking)
```

**Inline comments**: Use this format for file-specific findings:
```
::code-comment{file="path/to/file.ts" line="42" severity="P1"}
Description of the issue and suggested fix.
::
```

### 7) Next Steps Confirmation

After presenting findings, ask user how to proceed:

```markdown
---

## Next Steps

I found X issues (P0: _, P1: _, P2: _, P3: _).

**How would you like to proceed?**

1. **Fix all** - I'll implement all suggested fixes
2. **Fix P0/P1 only** - Address critical and high priority issues
3. **Fix specific items** - Tell me which issues to fix
4. **No changes** - Review complete, no implementation needed

Please choose an option or provide specific instructions.
```

## Resources

### references/

| File | Purpose |
|------|---------|
| `mv3-checklist.md` | Manifest V3 migration and compliance rules |
| `extension-security-checklist.md` | Security best practices for Extensions |
| `extension-performance-checklist.md` | Performance and quota management |
| `extension-architecture-checklist.md` | Architecture patterns and common pitfalls |
