import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as spatial from "../src/spatial.mjs"

// Substitute only the external history command boundary, not world logic.
class History {
    constructor() { this.entries = []; this.cursor = 0 }
    execute(command) { command.redo(); this.add(command) }
    add(command) { this.entries.splice(this.cursor); this.entries.push({ command }); this.cursor++ }
    undo() { if (this.canUndo()) this.entries[--this.cursor].command.undo() }
    redo() { if (this.canRedo()) this.entries[this.cursor++].command.redo() }
    canUndo() { return this.cursor > 0 }
    canRedo() { return this.cursor < this.entries.length }
    toArray() { return this.entries }
    get current() { return this.entries[this.cursor - 1] }
    dispose() {}
}
class Canvas {
    constructor() { this.width = 800; this.height = 600 }
    getBoundingClientRect() { return { left: 5, top: 7, width: 400, height: 300 } }
}
class Registry {
    draw(ctx, object, frame) { ctx.save(); ctx.translate(object.x, object.y); ctx.marks.push({ id: object.editorId, x: ctx.x, y: ctx.y, frame }); ctx.restore() }
    bounds(object) { return { minX: 0, minY: 0, maxX: object.props.width || 12, maxY: object.props.height || 8 } }
}
const source = readFileSync(new URL("../src/views/view-world.js", import.meta.url), "utf8")
    .replace(/^import .*\n/gm, "")
    .replace("export class ViewWorld", "class ViewWorld")
    .split('if (!customElements.get("view-world"))')[0]
const { WorldState, ViewWorld } = new Function("UndoHistory", "ViewCanvasBase", "WorldObjectRendererRegistry", "HTMLCanvasElement", "document", ...Object.keys(spatial), `${source}\nreturn { WorldState, ViewWorld }`)(History, class {}, Registry, Canvas, { createTextNode: (text) => text }, ...Object.values(spatial))
const group = (id, x, y, parent) => ({ x, y, spatial: { id, group: true, ...(parent ? { parent } : {}) } })
const leaf = (id, x, y, parent) => ({ x, y, spatial: { id, ...(parent ? { parent } : {}) }, width: 20, height: 10 })
function state(data) { const result = new WorldState(); result.open("world.json", JSON.stringify(data)); return result }
function position(state, index) { return spatial.worldPosition(state.objects, state.objects[index]) }
function view(state, invertX = false, invertY = false) {
    const result = Object.create(ViewWorld.prototype)
    Object.assign(result, { state, snapshot: state.snapshot(), scale: 2, offsetX: 0, offsetY: 0, invertX, invertY, rendererRegistry: new Registry(), canvas: new Canvas() })
    return result
}

test("flat worlds retain authored fields and organizational group semantics", () => {
    const data = [{ x: 5, y: -4, id: "legacy", group: "Decor", custom: [1, true] }, { x: 2, y: 8, group: "Decor" }]
    const world = state(data)
    assert.deepEqual(JSON.parse(world.toStorageData()), data)
    assert.deepEqual(position(world, 0), { x: 5, y: -4 })
    world.moveGroup("Decor", 1)
    assert.equal(world.objects.length, 2)
})

test("nested group movement translates descendants without rewriting locals; undo/redo", () => {
    const world = state([group("a", 100, 200), group("b", 20, -30, "a"), leaf("c", 4, 5, "b")])
    assert.deepEqual(position(world, 2), { x: 124, y: 175 })
    world.setObjectPosition(1, 150, 250)
    assert.deepEqual(position(world, 2), { x: 174, y: 225 })
    assert.equal(world.objects[2].x, 4)
    world.undo()
    assert.deepEqual(position(world, 2), { x: 124, y: 175 })
    world.redo()
    assert.deepEqual(position(world, 2), { x: 174, y: 225 })
})

test("reparent leaves and groups preserves world positions through undo/redo", () => {
    const world = state([group("a", 100, 200), group("b", 20, 30), leaf("c", 4, 5, "a")])
    const before = position(world, 2)
    world.reparentObject(3, "b")
    assert.deepEqual(position(world, 2), before)
    assert.equal(world.objects[2].x, 84)
    world.reparentObject(2, "a")
    assert.deepEqual(position(world, 2), before)
    assert.deepEqual(position(world, 1), { x: 20, y: 30 })
    world.undo(); world.undo()
    assert.equal(spatial.spatialParent(world.objects[2]), "a")
    world.redo(); world.redo()
    world.reparentObject(3, "")
    assert.deepEqual(position(world, 2), before)
})

test("legacy objects gain spatial identity only when parented", () => {
    const world = state([group("group-1", 10, 20), { x: 1, y: 2, id: "existing", group: "Legacy" }])
    world.reparentObject(2, "group-1")
    assert.equal(world.objects[1].spatial.id, "group-2")
    assert.deepEqual(world.objects[1].props, { id: "existing", group: "Legacy" })
    assert.deepEqual(position(world, 1), { x: 1, y: 2 })
    world.undo()
    assert.equal(world.objects[1].spatial, undefined)
})

test("delete group keeps children under grandparent and preserves subtree positions", () => {
    const world = state([group("a", 100, 200), group("b", 10, 20, "a"), group("c", 1, 2, "b"), leaf("d", 3, 4, "c")])
    const before = position(world, 3)
    world.selectObject(2)
    world.deleteObject(2)
    assert.equal(world.objects.length, 3)
    assert.equal(spatial.spatialParent(world.objects[1]), "a")
    assert.deepEqual(position(world, 2), before)
    world.undo()
    assert.equal(world.activeObjectId, 2)
    assert.deepEqual(position(world, 3), before)
    world.redo()
    world.deleteObject(1)
    assert.equal(spatial.spatialParent(world.objects[0]), "")
    assert.deepEqual(position(world, 1), before)
})

test("group creation, nested save/reopen and history preserve metadata", () => {
    const world = state([])
    const first = world.addGroup(10, 20)
    const second = world.addGroup(30, 40)
    world.reparentObject(second, world.requireObject(first).spatial.id)
    world.addObject(3, 4)
    world.reparentObject(world.activeObjectId, world.requireObject(second).spatial.id)
    const data = world.toStorageData()
    assert.equal(state(JSON.parse(data)).toStorageData(), data)
    assert.deepEqual(position(world, 2), { x: 3, y: 4 })
    world.undo(); world.redo()
    assert.equal(world.toStorageData(), data)
})
for (const [name, data, message] of [
    ["duplicate ids", [group("a", 0, 0), group("a", 1, 2)], /duplicate/],
    ["missing parent", [leaf("a", 0, 0, "missing")], /missing/],
    ["non-group parent", [leaf("a", 0, 0), leaf("b", 0, 0, "a")], /not a group/],
    ["self cycle", [group("a", 0, 0, "a")], /cycle/],
    ["nested cycle", [group("a", 0, 0, "b"), group("b", 0, 0, "a")], /cycle/],
    ["empty id", [group("", 0, 0)], /non-empty/],
    ["malformed spatial", [{ x: 0, y: 0, spatial: null }], /object/],
    ["unknown transform", [{ x: 0, y: 0, spatial: { id: "a", rotation: 1 } }], /unknown/],
]) test(`reject ${name}`, () => assert.throws(() => state(data), message))
test("invalid reparent fails atomically without history or position changes", () => {
    const world = state([group("a", 1, 2), group("b", 3, 4, "a")])
    const before = world.toStorageData()
    assert.throws(() => world.reparentObject(1, "b"), /cycle/)
    assert.throws(() => world.reparentObject(2, "b"), /cycle/)
    assert.equal(world.toStorageData(), before)
    assert.equal(world.history.canUndo(), false)
})
test("failed open leaves active world and editor-id allocation intact", () => {
    const world = state([group("a", 1, 2)])
    assert.throws(() => world.open("bad.json", JSON.stringify([leaf("b", 0, 0, "missing")])), /missing/)
    assert.equal(world.addObject(0, 0), 2)
})

test("undo group creation restores a valid previous selection", () => {
    const world = state([{ x: 1, y: 2 }])
    world.selectObject(1)
    const id = world.addGroup(3, 4)
    world.undo()
    assert.equal(world.activeObjectId, 1)
    assert.equal(world.objects.length, 1)
    world.redo()
    assert.equal(world.activeObjectId, id)
})
test("legacy group names cannot collide with spatial collapse keys", () => {
    const world = state([group("a", 10, 20), { x: 0, y: 0, group: "spatial:1" }])
    const canvas = view(world)
    canvas.collapsedGroups = new Set()
    canvas.renderObjects = () => {}
    canvas.setStatus = () => {}
    canvas.toggleGroupCollapsed("legacy:spatial:1")
    canvas.pruneCollapsedGroups(world.snapshot())
    assert.ok(canvas.collapsedGroups.has("legacy:spatial:1"))
    assert.equal(canvas.collapsedGroups.has("spatial:1"), false)
    canvas.toggleGroupCollapsed("spatial:1")
    canvas.toggleGroupCollapsed("legacy:spatial:1")
    assert.ok(canvas.collapsedGroups.has("spatial:1"))
})

for (const invertX of [false, true]) for (const invertY of [false, true]) {
    test(`canvas bounds/hits/tooltip/fit with inversion ${invertX}/${invertY}`, () => {
        const world = state([group("a", 100, 200), group("b", 30, 40, "a"), leaf("c", 10, 20, "b")])
        const canvas = view(world, invertX, invertY)
        const x = invertX ? -140 : 140
        const y = invertY ? -260 : 260
        assert.deepEqual(canvas.objectCanvasBounds(world.objects[2]), { minX: x, minY: y, maxX: x + 20, maxY: y + 10 })
        const point = { x: invertX ? -(x + 10) : x + 10, y: invertY ? -(y + 5) : y + 5 }
        assert.equal(canvas.hitTest(point).editorId, 3)
        assert.deepEqual(canvas.objectClientAabb(world.objects[2]), { kind: "aabb", x: x + 5, y: y + 7, width: 20, height: 10 })
        const bounds = canvas.objectCanvasBounds(world.objects[0])
        const fit = canvas.calculateContentBounds(canvas.snapshot)
        assert.ok(fit.minX <= bounds.minX && fit.maxX >= bounds.maxX)
        assert.match(canvas.objectTooltipContent(world.objects[2]), /world: 140, 260; local: 10, 20/)
        world.selectObject(1)
        canvas.snapshot = world.snapshot()
        assert.equal(canvas.hitTest({ x: 100, y: 200 }).editorId, 1)
    })
}
test("live group drag records one undo command and leaves descendant locals unchanged", () => {
    const world = state([group("a", 10, 20), leaf("b", 30, 40, "a")])
    world.moveObjectLive(1, 15, 26)
    world.moveObjectLive(1, 17, 28)
    world.commitLiveMove(1, { x: 10, y: 20 }, { x: 17, y: 28 })
    assert.deepEqual(position(world, 1), { x: 47, y: 68 })
    assert.equal(world.history.toArray().length, 1)
    world.undo()
    assert.deepEqual(position(world, 1), { x: 40, y: 60 })
    world.redo()
    assert.equal(world.objects[1].x, 30)
})

test("drawing leaves preserves global stacking and translates renderers/viewport by ancestors", () => {
    const world = state([group("a", 100, 200), leaf("b", 30, 40, "a"), leaf("c", 5, 6)])
    const canvas = view(world, true, false)
    const ctx = {
        x: 0, y: 0, stack: [], marks: [],
        save() { this.stack.push([this.x, this.y]) },
        restore() { [this.x, this.y] = this.stack.pop() },
        translate(x, y) { this.x += x; this.y += y },
        strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    }
    canvas.drawObjects(ctx, canvas.snapshot)
    assert.deepEqual(ctx.marks.map(({ id, x, y }) => ({ id, x, y })), [{ id: 2, x: -130, y: 240 }, { id: 3, x: -5, y: 6 }])
    assert.deepEqual(ctx.marks[0].frame.viewport, { minX: 130, minY: -240, maxX: 530, maxY: 60 })
})
test("canvas drag uses pointer deltas in parent coordinates for nested group", () => {
    const world = state([group("a", 100, 200), group("b", 20, 30, "a"), leaf("c", 40, 50, "b")])
    const canvas = view(world)
    canvas.getWorldPoint = (x, y) => ({ x, y })
    canvas.focus = () => {}
    canvas.refreshLiveSnapshot = () => { canvas.snapshot = world.snapshot() }
    canvas.refreshSnapshot = async () => { canvas.snapshot = world.snapshot() }
    canvas.onCanvasMouseDown({ button: 0, clientX: 120, clientY: 230 })
    assert.equal(canvas.objectDrag.editorId, 2)
    canvas.onCanvasMouseMove({ clientX: 127, clientY: 221 })
    canvas.onCanvasMouseUp({})
    assert.deepEqual(position(world, 2), { x: 167, y: 271 })
    assert.deepEqual({ x: world.objects[1].x, y: world.objects[1].y }, { x: 27, y: 21 })
    world.undo()
    assert.deepEqual(position(world, 2), { x: 160, y: 280 })
})

test("sidebar nesting and collapse leave canvas visibility and storage unchanged", () => {
    const world = state([group("a", 0, 0), group("b", 1, 2, "a"), leaf("c", 3, 4, "b"), leaf("d", 5, 6)])
    const canvas = view(world)
    const rows = []
    canvas.collapsedGroups = new Set()
    canvas.objectsElement = { replaceChildren() { rows.length = 0 }, appendChild(row) { rows.push(row) } }
    canvas.createObjectRow = (object) => ({ id: object.editorId, firstChild: { prepend(text) { this.indent = text.length } } })
    canvas.renderObjects(canvas.snapshot)
    assert.deepEqual(rows.map((row) => [row.id, row.firstChild.indent]), [[4, 0], [1, 0], [2, 2], [3, 4]])
    canvas.collapsedGroups.add("spatial:2")
    canvas.renderObjects(canvas.snapshot)
    assert.deepEqual(rows.map((row) => row.id), [4, 1, 2])
    assert.equal(canvas.snapshot.objects.length, 4)
    canvas.collapsedGroups.add("spatial:1")
    canvas.renderObjects(canvas.snapshot)
    assert.deepEqual(rows.map((row) => row.id), [4, 1])
})

test("table drops use top-first order and avoid no-op history", () => {
    const world = state([leaf("a", 1, 2), leaf("b", 3, 4), leaf("c", 5, 6)])
    assert.equal(world.dropObject(3, 2, "before"), false)
    assert.equal(world.history.canUndo(), false)
    assert.equal(world.dropObject(1, 3, "before"), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [2, 3, 1])
    assert.equal(world.dropObject(1, 2, "after"), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [1, 2, 3])
})

test("nested drop restores subtree order, world positions and selection through undo/redo", () => {
    const world = state([group("a", 100, 200), leaf("b", 20, 30, "a"), group("c", -10, -20), leaf("d", 5, 6, "c")])
    world.selectObject(2)
    const before = world.toStorageData()
    const positions = new Map(world.objects.map((object) => [object.editorId, spatial.worldPosition(world.objects, object)]))
    assert.equal(world.dropObject(1, 4, "before"), true)
    assert.equal(world.activeObjectId, 1)
    assert.equal(spatial.spatialParent(world.requireObject(1)), "c")
    assert.deepEqual(world.objects.map((object) => object.editorId), [3, 4, 1, 2])
    for (const object of world.objects) assert.deepEqual(spatial.worldPosition(world.objects, object), positions.get(object.editorId))
    assert.equal(world.history.toArray().length, 1)
    const after = world.toStorageData()
    world.undo()
    assert.equal(world.activeObjectId, 2)
    assert.equal(world.toStorageData(), before)
    world.redo()
    assert.equal(world.activeObjectId, 1)
    assert.equal(world.toStorageData(), after)
})

test("inside adds topmost child and before root detaches without moving world coords", () => {
    const world = state([group("a", 10, 20), leaf("b", 1, 2, "a"), group("c", 30, 40), leaf("d", 3, 4, "c")])
    assert.equal(world.dropObject(1, 3, "inside"), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [3, 4, 1, 2])
    assert.equal(spatial.spatialParent(world.requireObject(1)), "c")
    assert.equal(world.dropObject(1, 3, "before"), true)
    assert.equal(spatial.spatialParent(world.requireObject(1)), "")
    assert.deepEqual(spatial.worldPosition(world.objects, world.requireObject(2)), { x: 11, y: 22 })
})

test("drop gathers interleaved descendants preserving their internal stacking", () => {
    const world = state([group("a", 1, 2), leaf("b", 3, 4), leaf("c", 5, 6, "a"), group("d", 7, 8, "a"), leaf("e", 9, 10, "d")])
    assert.equal(world.dropObject(1, 2, "before"), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [2, 1, 3, 4, 5])
})

test("canDrop and mutation reject invalid targets, placements and descendant cycles atomically", () => {
    const world = state([group("a", 10, 20), group("b", 1, 2, "a"), leaf("c", 3, 4, "b")])
    const before = world.toStorageData()
    for (const args of [[1, 1, "before"], [1, 2, "inside"], [1, 3, "after"], [2, 3, "before"], [2, 3, "inside"], [1, 99, "before"], [99, 1, "after"], [3, 1, "bad"]]) {
        assert.equal(world.canDropObject(...args), false)
        assert.equal(world.dropObject(...args), false)
    }
    assert.equal(world.toStorageData(), before)
    assert.equal(world.history.canUndo(), false)
})

test("legacy blocks retain labels and reject splits identically in preview and mutation", () => {
    const world = state([{ x: 1, y: 2, group: "A" }, { x: 3, y: 4, group: "A" }, { x: 5, y: 6 }, { x: 7, y: 8, group: "B" }, { x: 9, y: 10, group: "B" }])
    for (const args of [[3, 1, "before"], [3, 5, "after"], [1, 4, "before"]]) {
        assert.equal(world.canDropObject(...args), false)
        assert.equal(world.dropObject(...args), false)
    }
    assert.equal(world.history.canUndo(), false)
    assert.equal(world.dropObject(1, 2, "before"), true)
    assert.deepEqual(world.objects.map((object) => object.props.group || ""), ["A", "A", "", "B", "B"])
    assert.equal(world.requireObject(1).spatial, undefined)
})

test("spatial Up/Down moves whole sibling subtrees using drop semantics", () => {
    const world = state([group("a", 1, 2), leaf("b", 3, 4, "a"), group("c", 5, 6), leaf("d", 7, 8, "c")])
    assert.equal(world.moveObject(1, 1), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [3, 4, 1, 2])
    assert.equal(world.moveObject(1, 1), false)
    world.undo()
    assert.deepEqual(world.objects.map((object) => object.editorId), [1, 2, 3, 4])
})

test("rerender cancels pending drag; collapsed targets hide but retain moved descendants", () => {
    const world = state([group("a", 10, 20), group("b", 30, 40), leaf("c", 1, 2, "a")])
    const canvas = view(world)
    let cancelled = 0
    const rows = []
    canvas.tableDragDrop = { cancel() { cancelled++ } }
    canvas.collapsedGroups = new Set(["spatial:2"])
    canvas.objectsElement = { replaceChildren() { rows.length = 0 }, appendChild(row) { rows.push(row) } }
    canvas.createObjectRow = (object) => ({ id: object.editorId, firstChild: { prepend() {} } })
    assert.equal(world.dropObject(1, 2, "inside"), true)
    canvas.snapshot = world.snapshot()
    canvas.renderObjects(canvas.snapshot)
    assert.deepEqual(rows.map((row) => row.id), [2])
    canvas.collapsedGroups.delete("spatial:2")
    canvas.renderObjects(canvas.snapshot)
    assert.deepEqual(rows.map((row) => row.id), [2, 1, 3])
    assert.equal(cancelled, 2)
})

for (const [placement, roots] of [["before", [4, 2, 5, 1]], ["after", [4, 2, 1, 5]]]) {
    test(`drop ${placement} interleaved target subtree matches the displayed sibling slot`, () => {
        const world = state([group("a", 10, 20), leaf("b", 30, 40), leaf("child", 1, 2, "a"), leaf("c", 50, 60), leaf("d", 70, 80)])
        const before = world.toStorageData()
        const positions = new Map(world.objects.map((object) => [object.editorId, spatial.worldPosition(world.objects, object)]))
        assert.equal(world.dropObject(5, 1, placement), true)
        assert.deepEqual(world.objects.filter((object) => !spatial.spatialParent(object)).toReversed().map((object) => object.editorId), roots)
        for (const object of world.objects) assert.deepEqual(spatial.worldPosition(world.objects, object), positions.get(object.editorId))
        const after = world.toStorageData()
        world.undo()
        assert.equal(world.toStorageData(), before)
        world.redo()
        assert.equal(world.toStorageData(), after)
    })
}

test("arrow movement respects sibling adjacency with interleaved target descendants", () => {
    const world = state([group("a", 10, 20), leaf("b", 30, 40), leaf("child", 1, 2, "a"), leaf("c", 50, 60)])
    assert.equal(world.moveObject(2, -1), true)
    assert.deepEqual(world.objects.filter((object) => !spatial.spatialParent(object)).toReversed().map((object) => object.editorId), [4, 1, 2])
    assert.deepEqual(world.objects.map((object) => object.editorId), [2, 1, 3, 4])
})

test("ordinary root arrow movement crosses a spatial sibling subtree, not its children", () => {
    const world = state([group("a", 10, 20), leaf("child", 1, 2, "a"), { x: 30, y: 40 }])
    assert.equal(world.moveObject(3, -1), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [3, 1, 2])
    assert.equal(world.requireObject(3).spatial, undefined)
    assert.equal(world.moveObject(3, 1), true)
    assert.deepEqual(world.objects.map((object) => object.editorId), [1, 2, 3])
})
