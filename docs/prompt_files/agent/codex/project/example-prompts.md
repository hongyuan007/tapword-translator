## Example Prompts For Reliable Delegation

### 1. Research Before Editing

```text
Use a researcher sub-agent first.
Inspect the relevant modules, identify affected files and edge cases, and return a short implementation plan before making changes.
```

### 2. Standard Non-Trivial Task

```text
Use a multi-agent workflow.
First, spawn a researcher sub-agent to inspect the codebase and identify affected files and risks.
Then implement the change with the smallest correct patch.
After edits, spawn a verifier sub-agent to inspect the changed files and run type-check plus the narrowest relevant tests.
Return a consolidated summary.
```

### 3. Bug Fix With Verification

```text
Fix this bug with a scoped change.
Before finishing, use a verifier sub-agent to confirm the intended behavior is present and run targeted checks.
If the verifier finds a problem, resolve it before returning.
```

### 4. Explicit Review

```text
Implement the requested change.
After implementation, use a reviewer sub-agent to look for regressions, missing tests, and maintainability issues.
Summarize findings first, then give the final outcome.
```

### 5. Parallel Research On Multiple Areas

```text
Use multiple researcher sub-agents in parallel.
Split the investigation by subsystem, then merge the findings into one implementation plan.
Do not start editing until the affected files and risks are clear.
```
