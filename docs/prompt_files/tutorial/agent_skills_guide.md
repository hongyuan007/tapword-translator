# GitHub Copilot Agent Skills Creation Guide

This guide is designed to instruct AI assistants on how to create, structure, and write effective "Agent Skills" for this project.

## What is an Agent Skill?

An **Agent Skill** is a specialized, self-contained set of instructions and resources that teaches GitHub Copilot (or other agents) how to perform a specific task or handle a specific domain within the project. Unlike general system instructions, skills are loaded **on-demand** when the user's query matches the skill's description.

## Directory Structure

All skills must be placed in the `.agents/skills/` directory. Each skill gets its own subdirectory.

```text
.agents/
  skills/
    <skill-name>/       # Directory name must match the skill 'name' exactly
      SKILL.md          # The main definition file (Required)
      templates/        # (Optional) Template files
      scripts/          # (Optional) Helper scripts
```

## `SKILL.md` Format

The `SKILL.md` file is the core of the skill. It uses **YAML Frontmatter** for metadata and **Markdown** for instructions.

### 1. YAML Frontmatter (Required)

Must be at the very top of the file.

```yaml
---
name: my-skill-name        # Must match directory name. Kebab-case.
description: A concise but specific description of what this skill does. Copilot uses this to decide WHEN to load this skill.
---
```

### 2. Body Content

The body should include:
- **Title**: H1 Header.
- **When to use**: Bullet points describing triggers.
- **Instructions**: Step-by-step guides, rules, or workflows.
- **Best Practices**: Dos and Don'ts.
- **Examples**: Concrete code snippets or usage examples.

## Template

Use this template when creating a new skill:

````markdown
---
name: <skill-name-kebab-case>
description: <Clear description of capabilities and use cases>
---

# <Skill Title>

## When to use this skill
- <Trigger condition 1>
- <Trigger condition 2>

## Instructions
<Detailed instructions on how to perform the task.>

## Best Practices
- <Rule 1>
- <Rule 2>

## Examples
```typescript
// <Code Example>
```
````

## Best Practices for Writing Skills

1.  **Specific Descriptions**: The `description` in the frontmatter is the **router**. It must be specific enough so the agent knows when to activate it, but broad enough to cover relevant use cases.
    *   *Bad*: "Helps with code."
    *   *Good*: "Guide for writing and debugging Playwright E2E tests for the TapWord Translator extension."
2.  **Actionable Instructions**: Don't just explain concepts; tell the agent *what to do*. Use imperative verbs.
3.  **Context-Aware**: Assume the agent has access to the codebase but needs guidance on *patterns* and *conventions* specific to this project.
4.  **Self-Contained**: Try to minimize external dependencies. If the skill requires a script, include it in the skill folder or reference a stable project script.

## Example: E2E Testing Skill

**Path**: `.agents/skills/e2e-testing/SKILL.md`

```markdown
---
name: e2e-testing
description: Guide for writing, running, and debugging Playwright E2E tests for the TapWord Translator Chrome extension.
---

# E2E Testing Guide

## When to use this skill
- When creating new E2E tests.
- When fixing failing tests.

## Writing Tests
1. Use `createLocalHtmlServer()` for the test page.
2. Always wait for background service initialization (`await page.waitForTimeout(2000)`).
...
```

## Task for AI Assistant

When asked to create a new skill:
1.  **Identify the Domain**: What specific task or technology does this skill cover? (e.g., "Database Migrations", "UI Components", "API Integration").
2.  **Determine Scope**: What should be included? What should be excluded?
3.  **Draft Content**: Write the `SKILL.md` following the template above.
4.  **Create Files**: Generate the directory and file structure.
