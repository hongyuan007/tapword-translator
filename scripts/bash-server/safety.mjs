/**
 * Command safety blocklist for the bash MCP server.
 *
 * A convenience filter to prevent obvious accidental destructive commands.
 * NOT a security boundary — determined users can bypass this easily.
 */

/** @typedef {{ blocked: boolean, reason?: string }} BlockCheckResult */

/**
 * Each entry: [RegExp pattern, human-readable reason].
 * Patterns are tested against the full command string (case-insensitive where appropriate).
 */
const BLOCKED_PATTERNS = [
    // Root deletion
    [/rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+.*|.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+|.*-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+)\s*\/(\s|$|\*)/, "Root deletion (rm -rf /)"],

    // Filesystem format
    [/\bmkfs\b/, "Filesystem format command (mkfs)"],

    // Device write via dd
    [/\bdd\b.*\bof\s*=\s*\/dev\//, "Direct device write (dd of=/dev/)"],

    // Fork bomb variants
    [/:\(\)\s*\{.*\|.*&\s*\}/, "Fork bomb pattern"],

    // Write to block devices
    [/>\s*\/dev\/sd/, "Write to block device (> /dev/sd*)"],

    // Root permission change
    [/chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+).*\b777\b.*\s+\/(\s|$)/, "Root permission change (chmod -R 777 /)"],

    // System path chown -R
    [/chown\s+(-[a-zA-Z]*R[a-zA-Z]*\s+).*\s+\/(etc|usr|bin|sbin|var|boot|sys|proc)(\s|\/|$)/, "System path ownership change (chown -R on system path)"],
    [/chown\s+(-[a-zA-Z]*R[a-zA-Z]*\s+).*\s+\/(\s|$)/, "Root ownership change (chown -R /)"],

    // Shutdown / reboot commands
    [/\b(shutdown|reboot|halt|poweroff)\b/, "System shutdown/reboot command"],

    // Init level changes
    [/\binit\s+[06]\b/, "Init level change (init 0 or init 6)"],

    // Hex escape sequences (potential bypass attempt)
    [/\\x[0-9a-fA-F]{2}/, "Hex escape sequence detected (potential filter bypass)"],

    // Suspicious non-ASCII / zero-width characters (potential bypass)
    // eslint-disable-next-line no-control-regex
    [/[\u0000-\u0008\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\uFEFF]/, "Suspicious control/zero-width Unicode characters detected"],
]

/**
 * Check if a command should be blocked.
 * @param {string} command - The raw command string to check.
 * @returns {BlockCheckResult}
 */
export function isCommandBlocked(command) {
    if (!command || typeof command !== "string") {
        return { blocked: true, reason: "Empty or invalid command" }
    }

    for (const [pattern, reason] of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
            return { blocked: true, reason }
        }
    }

    return { blocked: false }
}
