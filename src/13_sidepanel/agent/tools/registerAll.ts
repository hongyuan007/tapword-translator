/**
 * Auto-imports all tool modules in this directory to trigger self-registration.
 * Convention: files ending with Tool.ts or Tools.ts are auto-registered tools.
 */
import.meta.glob(
    ['./*Tool.ts', './*Tools.ts'],
    { eager: true },
)
