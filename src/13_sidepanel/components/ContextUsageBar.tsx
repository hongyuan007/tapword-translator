import { useState } from "react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ContextUsage } from "../types"

/** Percentage at which the bar turns amber. */
const AMBER_THRESHOLD = 60
/** Percentage at which the bar turns red and pulses. */
const DANGER_THRESHOLD = 80
/** Minimum displayed percentage. */
const MIN_DISPLAY_PERCENT = 1

/** SVG circle constants. */
const CIRCLE_SIZE = 16
const STROKE_WIDTH = 2
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface ContextUsageIndicatorProps {
    usage: ContextUsage | null
}

/** Interpolate from green → amber → red based on percentage. */
function getProgressColor(pct: number): string {
    if (pct >= DANGER_THRESHOLD) return "#ef4444" // red-500
    if (pct >= AMBER_THRESHOLD) return "#f59e0b" // amber-500
    return "#10b981" // emerald-500
}

export function ContextUsageIndicator({ usage }: ContextUsageIndicatorProps) {
    const [hovered, setHovered] = useState(false)

    const percentage = usage?.percentage ?? 0
    const displayPercent = percentage < MIN_DISPLAY_PERCENT ? (percentage === 0 ? 0 : MIN_DISPLAY_PERCENT) : percentage
    const strokeColor = getProgressColor(percentage)
    const strokeDashoffset = CIRCUMFERENCE - (percentage / 100) * CIRCUMFERENCE

    const tooltip = usage
        ? `${i18nModule.translate("sidepanel.contextUsage.tooltip")} ${displayPercent}% (${usage.tokensUsed.toLocaleString()} / ${usage.threshold.toLocaleString()} tokens)`
        : `${i18nModule.translate("sidepanel.contextUsage.tooltip")} 0%`

    return (
        <div
            className="relative flex items-center gap-1 cursor-default"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Tooltip */}
            {hovered && (
                <div className="absolute bottom-full left-0 mb-1.5 px-2 py-1 text-xs text-white bg-stone-700 rounded shadow whitespace-nowrap z-10">
                    {tooltip}
                </div>
            )}
            {/* Circular progress ring */}
            <svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} className="shrink-0 -rotate-90">
                {/* Background track */}
                <circle
                    cx={CIRCLE_SIZE / 2}
                    cy={CIRCLE_SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke="#d6d3d1"
                    strokeWidth={STROKE_WIDTH}
                />
                {/* Progress arc */}
                <circle
                    cx={CIRCLE_SIZE / 2}
                    cy={CIRCLE_SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={STROKE_WIDTH}
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className={`transition-all duration-500 ease-out ${percentage >= DANGER_THRESHOLD ? "animate-pulse" : ""}`}
                />
            </svg>
            {/* Percentage text */}
            <span className="text-[10px] text-stone-400 tabular-nums leading-none">{displayPercent}%</span>
        </div>
    )
}
