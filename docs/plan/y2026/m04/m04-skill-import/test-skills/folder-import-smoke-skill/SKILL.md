---
name: folder-import-smoke-skill
description: "Smoke-test skill for validating multi-file and nested-folder skill import and loading."
---

# Folder Import Smoke Skill

This skill is intentionally small but structurally rich. It exists to verify that:

- `SKILL.md` is recognized as the entry document.
- Nested files are indexed correctly.
- Supplementary files can be discovered and read by relative path.
- Mixed text file types survive import without flattening.

## Expected Folder Structure

- `SKILL.md`
- `examples/basic/example-request.md`
- `examples/deep/nested/response-template.txt`
- `fixtures/sample-config.json`
- `fixtures/notes/import-checklist.txt`
- `references/glossary/terms.md`

## Suggested Manual Checks

1. Import this skill package into the side panel.
2. Confirm the skill name and description appear correctly.
3. Use the preview to confirm the body was parsed from this file.
4. Ask the agent to load the skill and inspect the `<files>` section.
5. Ask the agent to read at least one nested file and verify its content.

## Expected Nested File Content

The file `examples/deep/nested/response-template.txt` contains the phrase:

`nested file read success`

The file `fixtures/sample-config.json` contains the key:

`"testCase": "folder-import-smoke"`
