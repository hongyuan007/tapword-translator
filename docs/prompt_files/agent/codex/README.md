## Codex Multi-Agent Migration Bundle

This folder contains a copy-ready Codex configuration that maps the old Copilot "orchestrator + subagent" workflow to Codex multi-agent roles.

### Folder Layout

- `config.toml`: Main Codex config snippet for enabling multi-agent and registering roles
- `agents/researcher.toml`: Read-heavy exploration and spec drafting
- `agents/implementer.toml`: Scoped code changes
- `agents/verifier.toml`: Verification, type-check, and targeted tests
- `agents/reviewer.toml`: Correctness, regression, and maintainability review
- `project/AGENTS.codex-snippet.md`: Project-level workflow rules to merge into `AGENTS.md`
- `project/example-prompts.md`: Example prompts to trigger the workflow reliably

### Recommended Migration

1. Copy `config.toml` into `~/.codex/config.toml` and merge with your existing config.
2. Copy the `agents/` directory into `~/.codex/agents/`.
3. Review `project/AGENTS.codex-snippet.md` and merge the parts you want into the project's `AGENTS.md`.
4. Use the prompts in `project/example-prompts.md` when you want deterministic delegation behavior.

### Important Differences From The Old Copilot Prompt

- Do not force the main agent to delegate everything.
- Use sub-agents mainly for research, review, and verification.
- Keep code edits centralized unless the task is clearly partitioned.
- Treat role files as persistent specialization and the conversation prompt as the task payload.
