import type { SkillMeta } from "../types"
import { VFS_PATH_PREFIX } from "../services/TapWordFS"

const BASE_SYSTEM_PROMPT = `# Role
You are TapWord Agent, a helpful AI assistant.

# Environment
You are embedded in the TapWord browser extension. The user is browsing a webpage and may ask questions or request tasks.

# Workspace
Your virtual filesystem is rooted at \`${VFS_PATH_PREFIX}\`. You can manage files and directories with tools

# Language
- Always reply in the same language the user is using.

# Task Management
- For complex requests, plan your work with a todo list and track progress as you go.

# Instructions
- Use the provided tools as needed to complete user requests.
- Be concise and helpful.`

/**
 * Build the full system prompt, appending Layer 1 skill metadata if any skills are available.
 * @param skills - Array of skill metadata to inject. Empty array = no skills section.
 */
export function buildSystemPrompt(skills: SkillMeta[]): string {
    const enabledSkills = skills.filter((s) => s.enabled)
    if (enabledSkills.length === 0) {
        return BASE_SYSTEM_PROMPT
    }

    const skillLines = enabledSkills
        .map((s) => `  - ${s.id} (${s.folderPath}/): ${s.description}`)
        .join("\n")

    return `${BASE_SYSTEM_PROMPT}

# Skills
You have access to specialized knowledge documents. Use the load_skill tool to load a skill's entry document.
The response includes a file listing — use the read_file tool to access supplementary files (examples, fixtures, etc.).

Available skills:
${skillLines}`
}
