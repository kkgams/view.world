import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as spatial from "../src/spatial.mjs"
import * as resize from "../src/resize.mjs"

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
class Events {
    listeners = new Map()
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    removeEventListener(name, callback) { assert.equal(this.listeners.get(name), callback); this.listeners.delete(name) }
}
class Canvas {
    constructor() {
        this.width = 800; this.height = 600; this.style = {}
        this.ownerDocument = new Events()
        this.ownerDocument.defaultView = new Events()
    }
    getBoundingClientRect() { return { left: 5, top: 7, width: 400, height: 300 } }
}
class Registry {
    canResize() { return false }
    resizeLimits() { return { minWidth: 1, minHeight: 1 } }
    draw(ctx, object, frame) { ctx.save(); ctx.translate(object.x, object.y); ctx.marks.push({ id: object.editorId, x: ctx.x, y: ctx.y, frame }); ctx.restore() }
    bounds(object) { return { minX: 0, minY: 0, maxX: object.props.width || 12, maxY: object.props.height || 8 } }
}
const source = readFileSync(new URL("../src/views/view-world.js", import.meta.url), "utf8")
    .replace(/^import .*\n/gm, "")
    .replace("export class ViewWorld", "class ViewWorld")
    .split('if (!customElements.get("view-world"))')[0]
const host = { call: async () => { throw new Error("Unexpected Host call") } }
class PanelElement {
    parentNode = null
    disabled = false
    removed = false
    remove() { this.removed = true; this.parentNode = null }
}
const { WorldState, ViewWorld } = new Function("UndoHistory", "ViewCanvasBase", "WorldObjectRendererRegistry", "HTMLCanvasElement", "document", "runtime", "unwrap", "HTMLFieldSetElement", "HTMLElement", ...Object.keys(spatial), ...Object.keys(resize), `${source}\nreturn { WorldState, ViewWorld }`)(History, class { disconnectedCallback() {} }, Registry, Canvas, { createTextNode: (text) => text }, host, result => { if (Object.hasOwn(result, "err")) throw new Error(result.err); return result.ok }, PanelElement, PanelElement, ...Object.values(spatial), ...Object.values(resize))
const group = (id, x, y, parent) => ({ x, y, spatial: { id, group: true, ...(parent ? { parent } : {}) } })
const leaf = (id, x, y, parent) => ({ x, y, spatial: { id, ...(parent ? { parent } : {}) }, width: 20, height: 10 })
function state(data) { const result = new WorldState(); result.open("world.json", JSON.stringify(data)); return result }
function position(state, index) { return spatial.worldPosition(state.objects, state.objects[index]) }
function view(state, invertX = false, invertY = false) {
    const result = Object.create(ViewWorld.prototype)
    Object.assign(result, { state, snapshot: state.snapshot(), scale: 2, offsetX: 0, offsetY: 0, invertX, invertY, rendererRegistry: new Registry(), rendererPanels: [], rendererGeneration: 1, isConnected: true, dataset: {}, initializingRenderers: false, canvas: new Canvas() })
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
    canvas.setData = () => {}
    canvas.renderSnapshot = () => {}
    canvas.setStatus = () => {}
    pressSelect(canvas, 120, 230)
    assert.deepEqual([...canvas.objectDrag.ids], [2])
    canvas.onCanvasMouseMove({ clientX: 127, clientY: 221, buttons: 1 })
    releaseSelect(canvas, 127, 221)
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

test("adding authored object properties is one undoable command and survives save/open", () => {
    const world = state([])
    const props = { render: "nine", nine: "panel.json", slice: "Panel", width: 80, height: 40 }
    const id = world.addObject(10, 20, props)
    props.width = 1000
    assert.equal(world.history.toArray().length, 1)
    assert.equal(world.requireObject(id).props.width, 80)
    const saved = world.toStorageData()
    world.undo()
    assert.equal(world.objects.length, 0)
    assert.equal(world.activeObjectId, 0)
    world.redo()
    assert.equal(world.activeObjectId, id)
    assert.equal(world.toStorageData(), saved)
    const reopened = state(JSON.parse(saved))
    assert.equal(reopened.toStorageData(), saved)
})








class ResizeRegistry extends Registry {
    constructor(origin = [0, 0]) { super(); this.origin = origin }
    canResize(object) { return ["nine", "rectangle", "sprite"].includes(object.props.render) }
    resize(_object, { width, height }) { return { width, height } }
    bounds(object) {
        const width = Number(object.props.width || 40), height = Number(object.props.height || 20)
        const minX = -width * this.origin[0], minY = -height * this.origin[1]
        return { minX, minY, maxX: minX + width, maxY: minY + height }
    }
}
function resizeView(data = [{ x: 10, y: 20, render: "nine", width: 40, height: 20 }], origin = [0, 0], invertX = false, invertY = false) {
    const world = state(data)
    world.selectObject(world.objects.at(-1).editorId)
    const canvas = view(world, invertX, invertY)
    Object.assign(canvas, {
        rendererRegistry: new ResizeRegistry(origin), resizeDrag: null, canvasGestureCleanup: null,
        getWorldPoint(x, y) { return this.canvasToProjectPoint({ x, y }) },
        focus() {}, setData() {}, renderSnapshot() {}, setStatus() {},
        async prepareRenderers() {},
    })
    return { world, canvas }
}
function selectView(data, invert = false) {
    const { world, canvas } = resizeView(data, [0, 0], invert, invert)
    world.selectObject(0)
    canvas.snapshot = world.snapshot()
    canvas.selectMode = true
    canvas.draw = () => {}
    canvas.openObjectTooltip = () => {}
    return { world, canvas }
}

function pressSelect(canvas, x, y, shiftKey = false) {
    canvas.onCanvasMouseDown({ button: 0, clientX: x, clientY: y, shiftKey, preventDefault() {} })
}

function releaseSelect(canvas, x, y) {
    canvas.onCanvasMouseUp({ button: 0, clientX: x, clientY: y })
}

test("box selection uses rendered bounds, nested world positions and reversed axes", () => {
    const { world, canvas } = selectView([
        group("parent", 10, 10), leaf("child", 30, 30, "parent"),
        { x: 75, y: 60 }, { x: 80, y: 70, lock: true }, { x: 160, y: 90 },
    ], true)
    const before = world.toStorageData()
    pressSelect(canvas, -145, -120)
    canvas.onCanvasMouseMove({ clientX: -18, clientY: -18, buttons: 1 })
    assert.deepEqual([...canvas.selectionDrag.preview], [2, 3])
    assert.equal(world.selectedObjectIds.size, 0)
    releaseSelect(canvas, -18, -18)
    assert.deepEqual([...canvas.snapshot.selectedObjectIds], [2, 3])
    assert.equal(world.activeObjectId, 0)
    assert.equal(world.toStorageData(), before)
    assert.equal(world.dirty, false)
    assert.equal(world.history.canUndo(), false)
    assert.equal(canvas.canvas.ownerDocument.listeners.size, 0)
})

test("Shift adds a box selection; Escape cancels the preview; an empty click clears", () => {
    const { world, canvas } = selectView([{ x: 20, y: 20 }, { x: 110, y: 60 }])
    pressSelect(canvas, 21, 21)
    releaseSelect(canvas, 21, 21)
    assert.equal(world.activeObjectId, 1)
    assert.deepEqual([world.objects[0].x, world.objects[0].y], [20, 20])
    pressSelect(canvas, 160, 90, true)
    const doc = canvas.canvas.ownerDocument
    doc.listeners.get("mouseup")({ button: 0, clientX: 100, clientY: 50 })
    assert.deepEqual([...world.selectedObjectIds], [1, 2])

    pressSelect(canvas, 0, 0)
    canvas.onCanvasMouseMove({ clientX: 65, clientY: 50, buttons: 1 })
    assert.deepEqual([...canvas.selectionDrag.preview], [1])
    doc.listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopPropagation() {} })
    assert.equal(canvas.selectionDrag, null)
    assert.equal(doc.listeners.size, 0)
    assert.equal(doc.defaultView.listeners.size, 0)
    assert.deepEqual([...world.selectedObjectIds], [1, 2])
    pressSelect(canvas, 0, 0)
    releaseSelect(canvas, 0, 0)
    assert.equal(world.selectedObjectIds.size, 0)
})

test("dragging a box-selected object moves the selection as one undoable edit", () => {
    const { world, canvas } = selectView([{ x: 30, y: 40 }, { x: 80, y: 90 }, { x: 150, y: 150 }], true)
    pressSelect(canvas, 20, 0)
    releaseSelect(canvas, -100, -115)
    pressSelect(canvas, -30, -40)
    canvas.onCanvasMouseMove({ clientX: -41, clientY: -34, buttons: 1 })
    assert.deepEqual(canvas.snapshot.objects.map(({ x, y }) => [x, y]), [[41, 34], [91, 84], [150, 150]])
    assert.deepEqual(world.objects.map(({ x, y }) => [x, y]), [[30, 40], [80, 90], [150, 150]])
    assert.equal(world.dirty, false)

    const doc = canvas.canvas.ownerDocument
    doc.listeners.get("mouseup")({ button: 0, clientX: -50, clientY: -30 })
    assert.deepEqual(world.objects.map(({ x, y }) => [x, y]), [[50, 30], [100, 80], [150, 150]])
    assert.deepEqual([...world.selectedObjectIds], [1, 2])
    assert.equal(doc.listeners.size, 0)
    assert.equal(world.history.toArray().length, 1)
    world.undo()
    assert.deepEqual(world.objects.map(({ x, y }) => [x, y]), [[30, 40], [80, 90], [150, 150]])
    world.redo()
    assert.deepEqual(world.objects.map(({ x, y }) => [x, y]), [[50, 30], [100, 80], [150, 150]])
})

test("drag moves descendants of a selected group once and skips directly locked objects", () => {
    const { world, canvas } = selectView([
        group("parent", 30, 30), group("nested", 30, 30, "parent"), leaf("child", 40, 50, "nested"),
        { x: 150, y: 150, lock: true }, { x: 250, y: 250 },
    ])
    world.selectObjects([1, 2, 3, 4, 5])
    canvas.snapshot = world.snapshot()
    canvas.selectMode = false
    pressSelect(canvas, 105, 112)
    releaseSelect(canvas, 115, 122)
    assert.deepEqual(world.objects.map(({ x, y }) => [x, y]), [[40, 40], [30, 30], [40, 50], [150, 150], [260, 260]])
    assert.deepEqual(position(world, 2), { x: 110, y: 120 })
})

test("Escape discards a move preview; picking an unselected object replaces the selection", () => {
    const { world, canvas } = selectView([{ x: 30, y: 40 }, { x: 80, y: 90 }, { x: 150, y: 150 }])
    world.selectObjects([1, 2])
    canvas.snapshot = world.snapshot()
    pressSelect(canvas, 35, 45)
    canvas.onCanvasMouseMove({ clientX: 45, clientY: 55, buttons: 1 })
    const doc = canvas.canvas.ownerDocument
    doc.listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopPropagation() {} })
    assert.equal(canvas.objectDrag, null)
    assert.equal(doc.listeners.size, 0)
    assert.equal(canvas.snapshot.objects[0].x, 30)
    assert.deepEqual([...world.selectedObjectIds], [1, 2])
    assert.equal(world.dirty, false)

    pressSelect(canvas, 155, 155)
    releaseSelect(canvas, 155, 155)
    assert.deepEqual([...world.selectedObjectIds], [3])
    assert.equal(world.history.canUndo(), false)
})

test("multi-selection is restored by undo and cleared when opening a new world", () => {
    const world = state([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    world.selectObjects([1, 2])
    const added = world.addObject(20, 20)
    assert.equal(world.activeObjectId, added)
    world.undo()
    assert.deepEqual([...world.selectedObjectIds], [1, 2])
    world.open("other.world.json", '[{"x": 0, "y": 0}]')
    assert.equal(world.selectedObjectIds.size, 0)
})

function pressResize(canvas, edge) {
    const object = canvas.snapshot.objects.find(object => object.editorId === canvas.snapshot.activeObjectId)
    const handle = resize.resizeHandles(canvas.objectCanvasBounds(object)).find(handle => handle.edge === edge)
    let prevented = false
    canvas.onCanvasMouseDown({ button: 0, clientX: handle.x, clientY: handle.y, preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(canvas.resizeDrag.edge, edge)
    assert.equal(canvas.objectDrag, undefined)
    return handle
}
function resizeMove(canvas, handle, dx, dy) {
    canvas.onCanvasMouseMove({ clientX: handle.x + dx, clientY: handle.y + dy, buttons: 1 })
}
function resizeRelease(canvas, handle, dx, dy) {
    canvas.onCanvasMouseUp({ button: 0, clientX: handle.x + dx, clientY: handle.y + dy })
}

test("resize previews without mutating world; release records one combined position/props command", () => {
    const { world, canvas } = resizeView()
    const original = world.toStorageData(), handle = pressResize(canvas, "nw")
    resizeMove(canvas, handle, -10, -6)
    resizeMove(canvas, handle, -20, -8)
    assert.equal(world.toStorageData(), original)
    assert.equal(world.dirty, false)
    assert.equal(world.history.toArray().length, 0)
    assert.deepEqual(canvas.snapshot.objects.map(o => [o.x, o.y, o.props.width, o.props.height]), [[-10, 12, 60, 28]])
    resizeRelease(canvas, handle, -20, -8)
    assert.equal(world.history.toArray().length, 1)
    assert.equal(world.history.toArray()[0].command.label, "Resize object")
    assert.deepEqual(world.objects.map(o => [o.x, o.y, o.props.width, o.props.height]), [[-10, 12, 60, 28]])
    assert.equal(canvas.resizeDrag, null)
    assert.equal(canvas.canvas.ownerDocument.listeners.size, 0)
    const saved = world.toStorageData()
    world.undo(); assert.equal(world.toStorageData(), original)
    world.redo(); assert.equal(world.toStorageData(), saved)
    assert.equal(state(JSON.parse(saved)).toStorageData(), saved)
})

for (const invertX of [false, true]) for (const invertY of [false, true]) {
    test(`nested resize fixes opposite canvas edges with inversion ${invertX}/${invertY}`, () => {
        for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
            const data = [group("a", 100, 200), group("b", 20, 30, "a"), { x: 10, y: 20, spatial: { id: "panel", parent: "b" }, render: "nine", width: 40, height: 20 }]
            const { world, canvas } = resizeView(data, [0.5, 1], invertX, invertY)
            const before = canvas.objectCanvasBounds(world.objects[2]), handle = pressResize(canvas, edge)
            resizeMove(canvas, handle, 12, -8)
            const after = canvas.objectCanvasBounds(canvas.snapshot.objects[2])
            assert.equal(edge.includes("w") ? after.maxX : after.minX, edge.includes("w") ? before.maxX : before.minX)
            assert.equal(edge.includes("n") ? after.maxY : after.minY, edge.includes("n") ? before.maxY : before.minY)
            resizeRelease(canvas, handle, 12, -8)
            assert.deepEqual(world.objects.slice(0, 2).map(o => [o.x, o.y]), [[100, 200], [20, 30]])
            assert.deepEqual(world.objects[2].spatial, { id: "panel", parent: "b" })
            assert.equal(world.history.toArray().length, 1)
        }
    })
}

test("resize handles keep screen hit areas at zoom and outrank overlapping objects", () => {
    const { world, canvas } = resizeView([{ x: 10, y: 20, render: "nine", width: 40, height: 20 }, { x: 45, y: 35 }])
    world.selectObject(1); canvas.snapshot = world.snapshot()
    canvas.scale = 4
    assert.deepEqual(canvas.resizeScreenSize(6), { x: 3, y: 3 })
    assert.equal(canvas.selectedResizeHandle({ x: 53, y: 43 }).edge, "se")
    assert.equal(canvas.selectedResizeHandle({ x: 53.1, y: 43 }), null)
    pressResize(canvas, "se")
    assert.equal(canvas.resizeDrag.before.editorId, 1)
    canvas.cancelResize()
    world.objects[0].props.lock = true; canvas.snapshot = world.snapshot()
    assert.equal(canvas.selectedResizeHandle({ x: 50, y: 40 }), null)
    world.selectObject(2); canvas.snapshot = world.snapshot()
    assert.equal(canvas.selectedResizeHandle({ x: 45, y: 35 }), null)
})

test("no-op resize and dragging away then back preserve natural-size props without history", () => {
    for (const move of [false, true]) {
        const { world, canvas } = resizeView([{ x: 10, y: 20, render: "sprite" }], [0.5, 0.5])
        const before = world.toStorageData(), handle = pressResize(canvas, "se")
        if (move) resizeMove(canvas, handle, 15, 9)
        resizeMove(canvas, handle, 0.1, 0.1)
        resizeRelease(canvas, handle, 0, 0)
        assert.equal(world.toStorageData(), before)
        assert.equal(world.history.toArray().length, 0)
        assert.equal(world.dirty, false)
    }
})

test("Escape, window blur, lost button and explicit cancellation discard preview and listeners", () => {
    for (const cause of ["Escape", "blur", "lost-button", "explicit"]) {
        const { world, canvas } = resizeView()
        const before = world.toStorageData(), handle = pressResize(canvas, "nw")
        resizeMove(canvas, handle, -12, -8)
        const doc = canvas.canvas.ownerDocument
        if (cause === "Escape") {
            let prevented = false, stopped = false
            doc.listeners.get("keydown")({ key: "Escape", preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
            assert(prevented && stopped)
        } else if (cause === "blur") doc.defaultView.listeners.get("blur")()
        else if (cause === "lost-button") canvas.onCanvasMouseMove({ buttons: 0, clientX: 100, clientY: 100 })
        else canvas.cancelResize()
        assert.equal(canvas.resizeDrag, null)
        assert.equal(world.toStorageData(), before)
        assert.equal(JSON.stringify(canvas.snapshot.objects), JSON.stringify(world.objects))
        assert.equal(world.history.toArray().length, 0)
        assert.equal(world.dirty, false)
        assert.equal(doc.listeners.size, 0)
        assert.equal(doc.defaultView.listeners.size, 0)
    }
})

test("outside-canvas drag/release completes resize; space does not start viewport panning", () => {
    const { world, canvas } = resizeView()
    const handle = pressResize(canvas, "se"), doc = canvas.canvas.ownerDocument
    let prevented = false
    doc.listeners.get("keydown")({ key: " ", preventDefault() { prevented = true }, stopPropagation() {} })
    assert(prevented)
    canvas.onCanvasMouseLeave({ buttons: 1 })
    assert(canvas.resizeDrag)
    doc.listeners.get("mousemove")({ target: {}, clientX: handle.x + 8, clientY: handle.y + 6, buttons: 1 })
    doc.listeners.get("mouseup")({ target: {}, button: 0, clientX: handle.x + 10, clientY: handle.y + 8 })
    assert.equal(world.objects[0].props.width, 50)
    assert.equal(world.objects[0].props.height, 28)
    assert.equal(world.history.toArray().length, 1)
    assert.equal(doc.listeners.size, 0)
})

test("side handles clamp to one pixel, preserve other axis, and rounded origins keep positions integral", () => {
    const { world, canvas } = resizeView(undefined, [0.5, 0.5])
    const before = canvas.objectCanvasBounds(world.objects[0]), handle = pressResize(canvas, "w")
    resizeMove(canvas, handle, 1000, 1000)
    const obj = canvas.snapshot.objects[0], after = canvas.objectCanvasBounds(obj)
    assert.equal(obj.props.width, 1)
    assert.equal(obj.props.height, 20)
    assert(Number.isInteger(obj.x) && Number.isInteger(obj.y))
    assert(Math.abs(before.maxX - after.maxX) <= 0.5)
    assert.equal(before.minY, after.minY)
    resizeRelease(canvas, handle, 1000, 1000)
    assert.equal(world.objects[0].props.width, 1)
})

test("geometry command rejects spatial groups, reserved props and non-integer coordinates", () => {
    const world = state([group("a", 0, 0), { x: 10, y: 20, width: 40, height: 20 }])
    for (const action of [
        () => world.resizeObject(1, 0, 0, {}),
        () => world.resizeObject(2, 0.5, 0, { width: 10 }),
        () => world.resizeObject(2, 0, 0, { x: 10 }),
        () => world.resizeObject(2, 0, 0, { spatial: {} }),
        () => world.resizeObject(2, 0, 0, { group: "other" }),
    ]) assert.throws(action)
    assert.equal(world.history.toArray().length, 0)
})

test("selection draws eight screen-sized handles only for enabled leaf renderers", () => {
    const { world, canvas } = resizeView()
    const squares = []
    const ctx = { save() {}, restore() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillRect(...args) { squares.push(args) } }
    canvas.drawSelection(ctx, world.objects[0])
    assert.equal(squares.length, 8)
    const rect = canvas.canvas.getBoundingClientRect()
    for (const [, , width, height] of squares) {
        assert.equal(width * canvas.scale * rect.width / canvas.canvas.width, 7)
        assert.equal(height * canvas.scale * rect.height / canvas.canvas.height, 7)
    }
    squares.length = 0
    canvas.drawSelection(ctx, world.objects[0], false)
    assert.equal(squares.length, 0)
    world.objects[0].props.lock = true
    canvas.drawSelection(ctx, world.objects[0])
    assert.equal(squares.length, 0)
    const groups = resizeView([group("a", 0, 0)])
    groups.canvas.drawSelection(ctx, groups.world.objects[0])
    assert.equal(squares.length, 0)
})

test("refresh and unmount discard previews and detach document/window listeners", async () => {
    for (const action of ["refresh", "disconnect"]) {
        const { world, canvas } = resizeView()
        const before = world.toStorageData(), handle = pressResize(canvas, "se"), doc = canvas.canvas.ownerDocument
        resizeMove(canvas, handle, 20, 20)
        if (action === "refresh") await canvas.refreshSnapshot("External state update")
        else {
            canvas.rendererRegistry.dispose = () => {}
            canvas.disconnectedCallback()
            assert.equal(canvas.rendererRegistry, null)
        }
        assert.equal(canvas.resizeDrag, null)
        assert.equal(doc.listeners.size, 0)
        assert.equal(doc.defaultView.listeners.size, 0)
        assert.equal(world.toStorageData(), before)
        assert.equal(world.history.toArray().length, 0)
    }
})

test("invalid renderer resize patches fail loudly and discard gesture state", () => {
    for (const patch of [{ x: 1 }, { spatial: {} }, { width: NaN }, { width: 1 }, Promise.resolve({ width: 50 })]) {
        const { world, canvas } = resizeView()
        const before = world.toStorageData(), handle = pressResize(canvas, "se")
        canvas.rendererRegistry.resize = () => patch
        assert.throws(() => resizeMove(canvas, handle, 10, 5))
        assert.equal(canvas.resizeDrag, null)
        assert.equal(canvas.canvas.ownerDocument.listeners.size, 0)
        assert.equal(world.toStorageData(), before)
        assert.equal(world.history.toArray().length, 0)
    }
})

for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    test(`${edge} handles obey renderer minima without moving the opposite edge`, () => {
        const { world, canvas } = resizeView()
        canvas.rendererRegistry.resizeLimits = () => ({ minWidth: 18, minHeight: 12 })
        const before = canvas.objectCanvasBounds(world.objects[0]), handle = pressResize(canvas, edge)
        const dx = edge.includes("w") ? 1000 : edge.includes("e") ? -1000 : 0
        const dy = edge.includes("n") ? 1000 : edge.includes("s") ? -1000 : 0
        resizeMove(canvas, handle, dx, dy)
        const preview = canvas.snapshot.objects[0], bounds = canvas.objectCanvasBounds(preview)
        assert.equal(preview.props.width, /[we]/.test(edge) ? 18 : 40)
        assert.equal(preview.props.height, /[ns]/.test(edge) ? 12 : 20)
        assert.equal(edge.includes("w") ? bounds.maxX : bounds.minX, edge.includes("w") ? before.maxX : before.minX)
        assert.equal(edge.includes("n") ? bounds.maxY : bounds.minY, edge.includes("n") ? before.maxY : before.minY)
        resizeRelease(canvas, handle, dx, dy)
        assert.equal(world.history.toArray().length, 1)
        world.undo(); assert.equal(world.objects[0].props.width, 40)
        world.redo(); assert.equal(world.objects[0].props.width, /[we]/.test(edge) ? 18 : 40)
    })
}


test("property editing checks renderer minimum before committing and restores caches on rejection", async () => {
    const { world, canvas } = resizeView()
    canvas.setBusy = busy => { canvas.busy = busy }
    const original = world.toStorageData(), preparations = [], calls = []
    host.call = async (method, props) => {
        calls.push([method, props])
        return { ok: method === "ui.popup.open" ? { data: { render: "nine", width: 1, height: 1 } } : null }
    }
    canvas.rendererRegistry.prepare = async objects => {
        preparations.push(structuredClone(objects))
        if (objects[0].props.width < 18 || objects[0].props.height < 12) throw new Error("Slice minimum is 18 × 12")
    }
    await canvas.edit()
    assert.equal(world.toStorageData(), original)
    assert.equal(world.history.toArray().length, 0)
    assert.equal(preparations.length, 2)
    assert.equal(preparations[0][0].props.width, 1)
    assert.equal(preparations[1][0].props.width, 40)
    assert(calls.some(([method, props]) => method === "ui.toast.error" && props.message === "Slice minimum is 18 × 12"))
    assert.equal(canvas.busy, false)
    host.call = async () => ({ ok: { data: { render: "nine", width: 18, height: 12 } } })
    await canvas.edit()
    assert.equal(world.objects[0].props.width, 18)
    assert.equal(world.history.toArray().length, 1)
})

function rendererPanelView() {
    const world = state([]), canvas = view(world)
    Object.assign(canvas, {
        busy: false, rendererPreparationKey: "",
        setBusy(busy) { this.busy = busy; this.renderRendererPanels(this.snapshot) },
        setData() {}, renderSnapshot() {}, setStatus() {},
    })
    canvas.rendererRegistry.prepare = async () => {}
    return { world, canvas }
}

test("generic renderer object creation validates before mutation, places at center and records one undo step", async () => {
    const { world, canvas } = rendererPanelView(), calls = []
    const properties = { kind: "custom", width: 70, height: 50 }
    canvas.rendererRegistry.prepare = async objects => {
        calls.push(objects)
        if (calls.length === 1) assert.equal(world.objects.length, 0)
    }
    const id = await canvas.addRendererObject(properties, canvas.rendererGeneration)
    properties.width = 999
    assert.deepEqual(world.objects.map(o => [o.editorId, o.x, o.y, o.props]), [[id, 200, 150, { kind: "custom", width: 70, height: 50 }]])
    assert.equal(world.activeObjectId, id)
    assert.equal(world.history.toArray().length, 1)
    assert.equal(canvas.busy, false)
    world.undo(); assert.equal(world.objects.length, 0)
    world.redo(); assert.equal(world.objects[0].props.width, 70)
})

test("generic add rejects invalid, unloaded, busy or obsolete requests without allocating state", async () => {
    const { world, canvas } = rendererPanelView()
    const id = world.nextObjectId
    await assert.rejects(canvas.addRendererObject({ x: 3 }, 1), /reserved/)
    canvas.busy = true
    await assert.rejects(canvas.addRendererObject({}, 1), /Create or open/)
    canvas.busy = false; world.loaded = false
    await assert.rejects(canvas.addRendererObject({}, 1), /Create or open/)
    world.loaded = true
    await assert.rejects(canvas.addRendererObject({}, 0), /no longer active/)
    const failure = new Error("Invalid renderer object")
    canvas.rendererRegistry.prepare = async () => { throw failure }
    await assert.rejects(canvas.addRendererObject({}, 1), error => error === failure)
    assert.equal(world.nextObjectId, id)
    assert.equal(world.objects.length, 0)
    assert.equal(world.history.toArray().length, 0)
    assert.equal(canvas.busy, false)
})

test("disconnect during renderer object preparation prevents stale creation", async () => {
    const { world, canvas } = rendererPanelView()
    let resolve
    canvas.rendererRegistry.prepare = () => new Promise(done => { resolve = done })
    const request = canvas.addRendererObject({ kind: "custom" }, 1)
    assert.equal(canvas.busy, true)
    canvas.rendererGeneration++
    canvas.isConnected = false
    resolve()
    await assert.rejects(request, /no longer active/)
    assert.equal(world.objects.length, 0)
    assert.equal(world.history.toArray().length, 0)
})

test("World mounts and disables generic fieldsets, then disposes/removes each panel", () => {
    const { canvas } = rendererPanelView(), element = new PanelElement(), calls = []
    const anchor = { before(panel) { calls.push("mount"); panel.parentNode = this } }
    canvas.historyElement = { closest: tag => { assert.equal(tag, "fieldset"); return anchor } }
    canvas.rendererRegistry.createSidebarPanels = context => {
        assert.equal(typeof context.addObject, "function")
        return [{ element, dispose() { calls.push("dispose") } }]
    }
    canvas.mountRendererPanels(1)
    assert.equal(element.parentNode, anchor)
    assert.equal(element.disabled, false)
    canvas.busy = true; canvas.renderRendererPanels(canvas.snapshot)
    assert.equal(element.disabled, true)
    canvas.busy = false; canvas.renderRendererPanels({ loaded: false })
    assert.equal(element.disabled, true)
    assert.throws(() => canvas.mountRendererPanels(1), /already mounted/)
    canvas.disposeRendererPanels()
    assert.deepEqual(calls, ["mount", "dispose"])
    assert.equal(element.removed, true)
    assert.deepEqual(canvas.rendererPanels, [])
})

test("World rejects invalid panel elements and cleans partially created controllers", () => {
    for (const element of [null, {}, Object.assign(new PanelElement(), { parentNode: {} })]) {
        const { canvas } = rendererPanelView(), calls = []
        canvas.rendererRegistry.createSidebarPanels = () => [{ element, dispose() { calls.push("dispose") } }]
        assert.throws(() => canvas.mountRendererPanels(1), /detached fieldset/)
        assert.deepEqual(calls, ["dispose"])
        assert.deepEqual(canvas.rendererPanels, [])
    }
})

test("World contains no renderer-specific sidebar imports or names", () => {
    assert.doesNotMatch(source, /nine|gams\.nine|import-nine|nine-slice|readNineDocument|renderers\.nine/i)
})

function initializationView() {
    const { world, canvas } = rendererPanelView()
    world.addObject(5, 6, { kind: "custom", width: 20, height: 10 })
    canvas.snapshot = world.snapshot()
    canvas.initializingRenderers = true
    canvas.viewConfig = { config: { renderers: {} } }
    canvas.historyElement = { closest: () => ({ before(element) { element.parentNode = this } }) }
    canvas.bootstrap = async () => { throw new Error("Reconnect must preserve loaded state") }
    return { world, canvas }
}
function lifecycleRegistry(calls, name) {
    const registry = new Registry()
    registry.prepare = async objects => { calls.push([name, "prepare", objects.length]) }
    registry.createSidebarPanels = () => [{ element: new PanelElement(), dispose() { calls.push([name, "panel-dispose"]) } }]
    registry.dispose = () => { calls.push([name, "dispose"]) }
    return registry
}

test("renderer/panel reconnect recreates controls once while preserving unsaved state and history", async () => {
    const { world, canvas } = initializationView(), calls = [], before = world.toStorageData(), history = world.history
    const previousFactory = Registry.create
    let count = 0
    Registry.create = async () => lifecycleRegistry(calls, ++count)
    try {
        await canvas.initializeRenderers()
        const first = canvas.rendererPanels[0]
        assert.equal(canvas.rendererPanels.length, 1)
        assert.equal(canvas.initializingRenderers, false)
        canvas.disconnectedCallback()
        assert.equal(first.element.removed, true)
        assert.equal(canvas.rendererPanels.length, 0)
        assert.equal(canvas.dataset.ready, undefined)
        assert.equal(canvas.initializingRenderers, true)
        await canvas.initializeRenderers()
        assert.equal(canvas.rendererPanels.length, 1)
        assert.notEqual(canvas.rendererPanels[0], first)
        assert.equal(world.toStorageData(), before)
        assert.equal(world.history, history)
        assert.equal(world.dirty, true)
        assert.equal(world.history.toArray().length, 1)
        assert.equal(calls.filter(call => call[1] === "panel-dispose").length, 1)
        assert.equal(calls.filter(call => call[1] === "dispose").length, 1)
    } finally { Registry.create = previousFactory }
})

test("late renderer factory after disconnect cannot mount panels into a newer connection", async () => {
    const { canvas } = initializationView(), calls = [], previousFactory = Registry.create
    let resolve
    Registry.create = () => new Promise(done => { resolve = done })
    try {
        const old = canvas.initializeRenderers()
        canvas.rendererRegistry.dispose = () => {}
        canvas.disconnectedCallback()
        Registry.create = async () => lifecycleRegistry(calls, "current")
        await canvas.initializeRenderers()
        const current = canvas.rendererRegistry, panels = canvas.rendererPanels
        resolve(lifecycleRegistry(calls, "obsolete"))
        await old
        assert.equal(canvas.rendererRegistry, current)
        assert.equal(canvas.rendererPanels, panels)
        assert.deepEqual(calls.filter(call => call[0] === "obsolete"), [["obsolete", "dispose"]])
    } finally { Registry.create = previousFactory }
})

test("stale preparation failure on disconnect cannot replace the current registry or panels", async () => {
    const { canvas } = initializationView(), calls = [], previousFactory = Registry.create
    const oldRegistry = lifecycleRegistry(calls, "old")
    let reject, started
    const waiting = new Promise(resolve => { started = resolve })
    oldRegistry.prepare = () => { started(); return new Promise((_resolve, fail) => { reject = fail }) }
    Registry.create = async () => oldRegistry
    try {
        const old = canvas.initializeRenderers()
        await waiting
        canvas.disconnectedCallback()
        Registry.create = async () => lifecycleRegistry(calls, "new")
        await canvas.initializeRenderers()
        const current = canvas.rendererRegistry, panels = canvas.rendererPanels
        reject(new Error("Preparation superseded by disposal"))
        await old
        assert.equal(canvas.rendererRegistry, current)
        assert.equal(canvas.rendererPanels, panels)
        assert.equal(canvas.initializingRenderers, false)
        assert.equal(calls.filter(call => call[0] === "old" && call[1] === "dispose").length, 1)
    } finally { Registry.create = previousFactory }
})

for (const [name, limits, edges, pointer] of [
    ["horizontal", { minWidth: 10, minHeight: 40, maxHeight: 40 }, ["e", "w"], { x: 30, y: 20 }],
    ["vertical", { minWidth: 40, maxWidth: 40, minHeight: 10 }, ["n", "s"], { x: 50, y: 40 }],
    ["region", { minWidth: 40, maxWidth: 40, minHeight: 40, maxHeight: 40 }, [], { x: 50, y: 60 }],
]) {
    test(`${name} selection draws and hits only permitted-axis handles`, () => {
        const { world, canvas } = resizeView([{ x: 10, y: 20, render: "nine", width: 40, height: 40 }])
        canvas.rendererRegistry.resizeLimits = () => limits
        canvas.rendererRegistry.canResize = () => limits.minWidth !== limits.maxWidth || limits.minHeight !== limits.maxHeight
        const squares = []
        const ctx = { save() {}, restore() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillRect(x, y, width, height) { squares.push({ x: x + width / 2, y: y + height / 2 }) } }
        canvas.drawSelection(ctx, world.objects[0])
        const expected = resize.resizeHandles(canvas.objectCanvasBounds(world.objects[0]), limits)
        assert.deepEqual(expected.map(handle => handle.edge), edges)
        assert.deepEqual(squares, expected.map(({ x, y }) => ({ x, y })))
        assert.equal(canvas.selectedResizeHandle(pointer), null)
        for (const handle of expected) assert.equal(canvas.selectedResizeHandle(handle).edge, handle.edge)
    })
}

test("fixed-height handle drag changes width only and maximum width preserves opposite edge", () => {
    const { world, canvas } = resizeView()
    canvas.rendererRegistry.resizeLimits = () => ({ minWidth: 10, maxWidth: 60, minHeight: 20, maxHeight: 20 })
    const handle = pressResize(canvas, "w"), before = canvas.objectCanvasBounds(world.objects[0])
    resizeMove(canvas, handle, -1000, 500)
    const preview = canvas.snapshot.objects[0], bounds = canvas.objectCanvasBounds(preview)
    assert.equal(preview.props.width, 60)
    assert.equal(preview.props.height, 20)
    assert.equal(preview.y, 20)
    assert.equal(bounds.maxX, before.maxX)
    assert.equal(bounds.minY, before.minY)
    resizeRelease(canvas, handle, -1000, 500)
    assert.equal(world.objects[0].props.width, 60)
    world.undo(); assert.equal(world.objects[0].props.width, 40)
    world.redo(); assert.equal(world.objects[0].props.width, 60)
})
