import * as loggerModule from "@/0_common/utils/logger"
import * as SkillStorageService from "../../services/SkillStorageService"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("skillTools")

export const loadSkillTool: ToolRegistration = {
    definition: {
        name: "load_skill",
        description:
            "Load the full content of a specialized skill document by its ID. " +
            "Use this tool when you need detailed instructions or domain knowledge " +
            "listed in the 'Skills available' section of your instructions.",
        input_schema: {
            type: "object" as const,
            properties: {
                skill_id: {
                    type: "string",
                    description: "The skill identifier (e.g., 'e2e-testing').",
                },
            },
            required: ["skill_id"],
        },
    },
    label: "Loading skill...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const skillId = input.skill_id as string
        if (!skillId) {
            throw new Error("skill_id is required")
        }

        // Check enabled status before loading body
        const metas = await SkillStorageService.loadSkillMetas()
        const meta = metas.find((m) => m.id === skillId)

        if (meta && !meta.enabled) {
            logger.warn(`Skill '${skillId}' is disabled`)
            return `Error: Skill '${skillId}' is currently disabled.`
        }

        const body = await SkillStorageService.getSkillBody(skillId)
        if (!body) {
            const available = metas.filter((m) => m.enabled).map((m) => m.id).join(", ")
            logger.warn(`Skill not found: ${skillId}. Available: ${available}`)
            return `Error: Unknown skill '${skillId}'. Available skills: ${available || "(none)"}`
        }

        const name = meta?.name ?? skillId
        const folderPath = meta?.folderPath ?? `unknown`
        const files = meta?.files ?? []
        const filesSection = files.map((f) => `- ${f}`).join("\n")

        logger.info(`Loaded skill '${skillId}': ${body.length} chars, ${files.length} files`)
        return `<skill name="${name}" path="${folderPath}/">\n<files>\n${filesSection}\n</files>\n<content>\n${body}\n</content>\n</skill>`
    },
}
