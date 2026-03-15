import * as tapWordDetector from "@/1_content/handlers/utils/tapWordDetector"

type GetActiveRanges = () => Map<string, Range>

function rangeFullyContainsRange(outerRange: Range, innerRange: Range): boolean {
    try {
        const startsBeforeOrAtInnerStart = outerRange.compareBoundaryPoints(Range.START_TO_START, innerRange) <= 0
        const endsAfterOrAtInnerEnd = outerRange.compareBoundaryPoints(Range.END_TO_END, innerRange) >= 0

        return startsBeforeOrAtInnerStart && endsAfterOrAtInnerEnd
    } catch {
        return false
    }
}

export function isFullyContainedBySingleActiveTranslation(candidateRange: Range, getActiveRanges: GetActiveRanges): boolean {
    const activeRanges = getActiveRanges()

    for (const [, activeRange] of activeRanges) {
        if (rangeFullyContainsRange(activeRange, candidateRange)) {
            return true
        }
    }

    return false
}

export function findSingleClickWordCandidateRangeFromPoint(
    x: number,
    y: number,
    getActiveRanges: GetActiveRanges
): Range | null {
    const range = tapWordDetector.getWordRangeFromPoint(x, y)
    if (!range) return null

    return isFullyContainedBySingleActiveTranslation(range, getActiveRanges) ? null : range
}
