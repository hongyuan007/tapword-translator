## Codex Multi-Agent Workflow Snippet

Use this snippet as a source when updating the project's `AGENTS.md`.

### Multi-Agent Policy

- For non-trivial tasks, prefer a staged workflow: research first, implementation second, verification last.
- Use sub-agents primarily for read-heavy exploration, review, and verification.
- Keep code edits centralized unless the task can be partitioned into clearly independent file sets.
- Do not forward raw user wording to a sub-agent when a clearer technical task can be written.
- When task scope is unclear, spawn a research-oriented sub-agent before editing.
- When logic changes are made, use a verifier sub-agent before declaring completion.

### Complexity Heuristic

Treat a task as non-trivial when any of the following are true:

- More than two files are likely to change
- The correct implementation path is not obvious
- The task touches shared abstractions or architecture
- Verification requires more than visual inspection

### Suggested Delegation Pattern

#### Simple task

- Main agent may implement directly
- Use a verifier sub-agent if logic changed

#### Non-trivial task

1. Spawn a researcher sub-agent to inspect the codebase and identify affected files, dependencies, and risks
2. Main agent or implementer sub-agent applies the scoped changes
3. Spawn a verifier sub-agent to confirm the intended behavior and run targeted checks
4. Spawn a reviewer sub-agent when an explicit review is requested or the change is high risk

### What Not To Port From Copilot

- Do not require the main agent to delegate everything
- Do not forbid the main agent from reading source code
- Do not force review or verification through a separate agent for trivial documentation-only edits
