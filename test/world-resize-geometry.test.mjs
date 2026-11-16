import test from "node:test"
import assert from "node:assert/strict"
import { resizeHandles, hitResizeHandle, resizeBounds } from "../src/resize.mjs"

const bounds = { minX: 10, minY: 20, maxX: 40, maxY: 60 }

test("eight handles use corners and side centers with directional cursors", () => {
    assert.deepEqual(resizeHandles(bounds), [
        ["nw", 10, 20], ["n", 25, 20], ["ne", 40, 20], ["e", 40, 40],
        ["se", 40, 60], ["s", 25, 60], ["sw", 10, 60], ["w", 10, 40],
    ].map(([edge, x, y]) => ({ edge, x, y, cursor: `${edge}-resize` })))
})

for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    test(`${edge} changes only active axes and keeps opposite edges fixed`, () => {
        const next = resizeBounds(bounds, edge, 7, -3)
        assert.equal(next.maxX - next.minX, 30 + (edge.includes("w") ? -7 : edge.includes("e") ? 7 : 0))
        assert.equal(next.maxY - next.minY, 40 + (edge.includes("n") ? 3 : edge.includes("s") ? -3 : 0))
        assert.equal(edge.includes("w") ? next.maxX : next.minX, edge.includes("w") ? bounds.maxX : bounds.minX)
        assert.equal(edge.includes("n") ? next.maxY : next.minY, edge.includes("n") ? bounds.maxY : bounds.minY)
    })
}

test("crossing fixed edge clamps to one pixel without flipping", () => {
    assert.deepEqual(resizeBounds(bounds, "nw", 1000, 1000), { minX: 39, minY: 59, maxX: 40, maxY: 60 })
    assert.deepEqual(resizeBounds(bounds, "se", -1000, -1000), { minX: 10, minY: 20, maxX: 11, maxY: 21 })
    assert.deepEqual(resizeBounds(bounds, "w", 1000, 1000), { minX: 39, minY: 20, maxX: 40, maxY: 60 })
})

test("pointer deltas snap to pixels; zero delta leaves bounds unchanged", () => {
    assert.deepEqual(resizeBounds(bounds, "se", 0.4, -0.4), bounds)
    assert.deepEqual(resizeBounds(bounds, "nw", 1.8, -2.2), { minX: 12, minY: 18, maxX: 40, maxY: 60 })
    for (const [edge, dx, dy] of [["bad", 0, 0], ["nw", Infinity, 0], ["n", 0, NaN]])
        assert.throws(() => resizeBounds(bounds, edge, dx, dy))
})

test("handle hit testing uses independent screen tolerances and nearest overlapping handle", () => {
    assert.equal(hitResizeHandle(bounds, { x: 44, y: 61 }, 4, 2).edge, "se")
    assert.equal(hitResizeHandle(bounds, { x: 44.1, y: 61 }, 4, 2), null)
    assert.equal(hitResizeHandle(bounds, { x: 40, y: 62.1 }, 4, 2), null)
    assert.equal(hitResizeHandle(bounds, { x: 25, y: 40 }, 4, 4), null)
    const tiny = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    assert.equal(hitResizeHandle(tiny, { x: 1, y: 1 }, 6, 6).edge, "se")
    assert.equal(hitResizeHandle(tiny, { x: 0.5, y: 0 }, 6, 6).edge, "n")
})

test("renderer minima clamp each dragged edge while keeping the opposite edge fixed", () => {
    const limits = { minWidth: 18, minHeight: 25 }
    assert.deepEqual(resizeBounds(bounds, "nw", 1000, 1000, limits), { minX: 22, minY: 35, maxX: 40, maxY: 60 })
    assert.deepEqual(resizeBounds(bounds, "se", -1000, -1000, limits), { minX: 10, minY: 20, maxX: 28, maxY: 45 })
    assert.deepEqual(resizeBounds(bounds, "n", 1000, 1000, limits), { minX: 10, minY: 35, maxX: 40, maxY: 60 })
    assert.deepEqual(resizeBounds(bounds, "w", 1000, 1000, limits), { minX: 22, minY: 20, maxX: 40, maxY: 60 })
})

test("fixed axes suppress incompatible handles and both fixed axes suppress all handles", () => {
    const horizontal = { minWidth: 6, minHeight: 40, maxHeight: 40 }
    const vertical = { minWidth: 30, maxWidth: 30, minHeight: 8 }
    assert.deepEqual(resizeHandles(bounds, horizontal).map(handle => handle.edge), ["e", "w"])
    assert.deepEqual(resizeHandles(bounds, vertical).map(handle => handle.edge), ["n", "s"])
    assert.deepEqual(resizeHandles(bounds, { ...horizontal, minWidth: 30, maxWidth: 30 }), [])
    assert.equal(hitResizeHandle(bounds, { x: 25, y: 20 }, 4, 4, horizontal), null)
    assert.equal(hitResizeHandle(bounds, { x: 40, y: 40 }, 4, 4, horizontal).edge, "e")
})

test("maximum dimensions stop expansion while retaining the opposite edge", () => {
    const limits = { minWidth: 6, minHeight: 8, maxWidth: 50, maxHeight: 60 }
    assert.deepEqual(resizeBounds(bounds, "nw", -1000, -1000, limits), { minX: -10, minY: 0, maxX: 40, maxY: 60 })
    assert.deepEqual(resizeBounds(bounds, "se", 1000, 1000, limits), { minX: 10, minY: 20, maxX: 60, maxY: 80 })
    const fixedHeight = { minWidth: 6, minHeight: 40, maxHeight: 40 }
    assert.deepEqual(resizeBounds(bounds, "se", 10, 500, fixedHeight), { minX: 10, minY: 20, maxX: 50, maxY: 60 })
})
