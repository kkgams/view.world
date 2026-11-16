// Bounds and pointer deltas are in canvas-world coordinates, before viewport zoom.
const EDGES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

export function resizeHandles(bounds) {
    return EDGES.map(edge => ({
        edge,
        x: edge.includes("w") ? bounds.minX : edge.includes("e") ? bounds.maxX : (bounds.minX + bounds.maxX) / 2,
        y: edge.includes("n") ? bounds.minY : edge.includes("s") ? bounds.maxY : (bounds.minY + bounds.maxY) / 2,
        cursor: `${edge}-resize`,
    }))
}

export function hitResizeHandle(bounds, point, toleranceX, toleranceY) {
    const hits = resizeHandles(bounds).filter(handle =>
        Math.abs(point.x - handle.x) <= toleranceX && Math.abs(point.y - handle.y) <= toleranceY)
    hits.sort((a, b) => Math.hypot((point.x - a.x) / toleranceX, (point.y - a.y) / toleranceY) -
        Math.hypot((point.x - b.x) / toleranceX, (point.y - b.y) / toleranceY))
    return hits[0] || null
}

export function resizeBounds(bounds, edge, dx, dy, limits = { minWidth: 1, minHeight: 1 }) {
    if (!EDGES.includes(edge)) throw new Error(`Unknown resize handle ${edge}`)
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("Resize deltas must be finite")
    const startWidth = bounds.maxX - bounds.minX, startHeight = bounds.maxY - bounds.minY
    const width = /[we]/.test(edge) ? Math.max(limits.minWidth, startWidth + (edge.includes("w") ? -Math.round(dx) : Math.round(dx))) : startWidth
    const height = /[ns]/.test(edge) ? Math.max(limits.minHeight, startHeight + (edge.includes("n") ? -Math.round(dy) : Math.round(dy))) : startHeight
    const minX = edge.includes("w") ? bounds.maxX - width : bounds.minX
    const minY = edge.includes("n") ? bounds.maxY - height : bounds.minY
    return { minX, minY, maxX: minX + width, maxY: minY + height }
}
