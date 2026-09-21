export function normalizeLineRange(range) {
    const start = Math.max(1, Math.min(range.lineStart, range.lineEnd));
    const end = Math.max(start, Math.max(range.lineStart, range.lineEnd));
    return {
        filePath: range.filePath.replace(/\\/g, '/'),
        lineStart: start,
        lineEnd: end
    };
}
export function rangesOverlap(left, right) {
    return Math.max(left.lineStart, right.lineStart) <= Math.min(left.lineEnd, right.lineEnd);
}
export function intersectRanges(left, right) {
    return normalizeLineRange({
        filePath: left.filePath,
        lineStart: Math.max(left.lineStart, right.lineStart),
        lineEnd: Math.min(left.lineEnd, right.lineEnd)
    });
}
export function rangeLength(range) {
    return Math.max(0, range.lineEnd - range.lineStart + 1);
}
