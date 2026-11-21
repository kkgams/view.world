import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { validateSpatial, worldPosition } from "../src/spatial.mjs"
const source = await readFile(new URL("../src/world-renderers/nine.js", import.meta.url), "utf8")
class Context { calls = []; drawImage(...args) { this.calls.push(args.slice(1)) } }
class Bitmap {
  constructor(width = 100, height = 100) { Object.assign(this, { width, height, closed: 0 }) }
  close() { this.closed++ }
}
function slice(type = "nine", name = type) {
  const s = { name, type, bounds: { x: 10, y: 20, width: 12, height: 10 } }
  if (type !== "region") s.center = { x: type === "vertical" ? 0 : 2, y: type === "horizontal" ? 0 : 3, width: type === "vertical" ? 12 : 6, height: type === "horizontal" ? 10 : 2 }
  return s
}
const doc = (image = "art/atlas.png", slices = [slice()]) => ({ format: "gams.nine", version: 1, image, slices })
const object = (patch = {}) => ({ props: { render: "nine", nine: "panels/ui.json", slice: "nine", width: "20", height: 18, ...patch } })
function fixture({ documents = {}, read, decode } = {}) {
  const reads = [], images = [], blobs = []
  // Adapt only the Host import and browser boundaries; execute real renderer code.
  const body = source.replace(/^import .*$/gm, "").replace(/^export /gm, "")
  const module = new Function("runtime", "unwrap", "CanvasRenderingContext2D", "createImageBitmap", `${body}\nreturn { createWorldObjectRenderer, readNineDocument, nineSliceLimits }`)(
    { async invoke(op, path) {
      reads.push([op, path])
      if (read) { const result = await read(op, path); if (result !== undefined) return result }
      return { ok: op.endsWith("read-text") ? JSON.stringify(documents[path] || doc()) : [1, 2, 3] }
    } },
    r => { if (Object.hasOwn(r, "err")) throw new Error(r.err); return r.ok }, Context,
    async blob => { blobs.push(blob); const image = decode ? await decode() : new Bitmap(); images.push(image); return image },
  )
  return { ...module, reads, images, blobs, renderer: config => module.createWorldObjectRenderer({ config: config || {} }) }
}
function draws(renderer, obj, viewport) {
  const ctx = new Context(); renderer.draw(ctx, obj, { scale: 2, viewport })
  assert.equal(ctx.imageSmoothingEnabled, false)
  return ctx.calls
}

test("caches share atlas paths, evict unused documents and close once", async () => {
  const f = fixture(), r = f.renderer(), a = object(), b = object({ nine: "other.json" })
  assert.throws(() => r.bounds(a), /not prepared/)
  await r.prepare([a, a, b]); await r.prepare([a, b]); assert.equal(f.reads.length, 3); assert.equal(f.images.length, 1)
  await r.prepare([b]); assert.equal(f.images[0].closed, 0); assert.throws(() => r.bounds(a), /not prepared/)
  await r.prepare([a, b]); assert.equal(f.reads.length, 4)
  await r.prepare([]); assert.equal(f.images[0].closed, 1)
  await r.prepare([a]); r.dispose(); r.dispose()
  assert.deepEqual(f.images.map(i => i.closed), [1, 1]); assert.throws(() => r.bounds(a), /not prepared/)
})
test("PNG, JPG, JPEG, WebP MIME types and raw bytes", async () => {
  for (const [ext, mime] of [["PNG", "png"], ["jpg", "jpeg"], ["jpeg", "jpeg"], ["webp", "webp"]]) {
    const f = fixture({ documents: { "a.json": doc(`atlas.${ext}`) } }), r = f.renderer()
    await r.prepare([object({ nine: "a.json" })]); assert.equal(f.blobs[0].type, `image/${mime}`)
    assert.deepEqual([...new Uint8Array(await f.blobs[0].arrayBuffer())], [1,2,3]); r.dispose()
  }
})
for (const mode of ["read", "schema", "json", "decode", "dimensions", "extension", "bounds", "missing"]) {
  test(`${mode} failure preserves old cache and closes staged bitmaps`, async () => {
    let decoding = 0
    const documents = { "new.json": doc("new.png"), "bad.json": doc(mode === "extension" ? "bad.svg" : "bad.png") }
    if (mode === "schema") documents["bad.json"].version = 2
    if (mode === "bounds") documents["bad.json"].slices.push({ ...slice("region", "unused"), bounds: { x: 99, y: 0, width: 2, height: 1 } })
    const f = fixture({ documents,
      read: async (_op, path) => {
        if (path === "bad.json" && mode === "json") return { ok: "{" }
        if (path === "bad.png" && mode === "read") return { err: "read failure" }
      },
      decode: async () => {
        decoding++; if (decoding === 3 && mode === "decode") throw new Error("decode failure")
        return new Bitmap(decoding === 3 && mode === "dimensions" ? 0 : 100)
      },
    })
    const r = f.renderer(), old = object(); await r.prepare([old])
    await assert.rejects(r.prepare([object({ nine: "new.json" }), object({ nine: "bad.json", slice: mode === "missing" ? "absent" : "nine" })]))
    assert.equal(f.images[0].closed, 0); assert.ok(f.images.slice(1).every(i => i.closed === 1))
    assert.equal(draws(r, old).length, 35); assert.throws(() => r.bounds(object({ nine: "new.json" })), /not prepared/)
    assert.throws(() => r.bounds(object({ slice: "absent" })), /slice not found/)
    const before = f.reads.length; await r.prepare([object({ nine: "new.json" })]); assert.equal(f.reads.length, before + 2)
    assert.equal(f.images[0].closed, 1); r.dispose(); assert.ok(f.images.every(i => i.closed === 1))
  })
}
test("dispose during async load rejects stale commit and closes bitmap", async () => {
  let resolve, started
  const waiting = new Promise(r => { started = r })
  const f = fixture({ decode: () => { started(); return new Promise(r => { resolve = r }) } })
  const r = f.renderer(), pending = r.prepare([object()]); await waiting; r.dispose(); resolve(new Bitmap())
  await assert.rejects(pending, /superseded/); assert.equal(f.images[0].closed, 1)
  assert.throws(() => r.bounds(object()), /not prepared/)
})
test("only imports absolute Host runtime", () => {
  assert.deepEqual(source.match(/^import .*$/gm), ['import { runtime, unwrap } from "/core/runtime.js"'])
})
for (const type of ["region", "horizontal", "vertical", "nine"]) {
  test(`${type} draw geometry`, async () => {
    const f = fixture({ documents: { "panels/ui.json": doc("art/atlas.png", [slice(type)]) } })
    const renderer = f.renderer(), obj = object({ slice: type, width: ["region", "vertical"].includes(type) ? 12 : 20, height: ["region", "horizontal"].includes(type) ? 10 : 18 }); await renderer.prepare([obj])
    const xs = ["region", "vertical"].includes(type) ? [[10, 12, 0, 12]] : [[10, 2, 0, 2], [12, 6, 2, 6], [12, 6, 8, 6], [12, 2, 14, 2], [18, 4, 16, 4]]
    const ys = ["region", "horizontal"].includes(type) ? [[20, 10, 0, 10]] : [[20, 3, 0, 3], [23, 2, 3, 2], [23, 2, 5, 2], [23, 2, 7, 2], [23, 2, 9, 2], [23, 2, 11, 2], [25, 5, 13, 5]]
    assert.deepEqual(draws(renderer, obj), ys.flatMap(([sy, sh, dy, dh]) => xs.map(([sx, sw, dx, dw]) => [sx, sy, sw, sh, dx, dy, dw, dh])))
    assert.deepEqual(f.reads, [["fs/fs::read-text", "panels/ui.json"], ["fs/fs::read-file", "art/atlas.png"]])
  })
}
test("viewport skips offscreen tiles without shifting their phase or cropping them", async () => {
  const r = fixture().renderer({ origin: [0.5, 0.5] })
  const obj = object({ width: 1200, height: 800 })
  await r.prepare([obj])
  assert.deepEqual(draws(r, obj, { minX: -2, minY: 0, maxX: 1, maxY: 1 }), [
    [12, 23, 6, 2, -4, -1, 6, 2],
  ])
  assert.deepEqual(draws(r, obj, { minX: 600, minY: 0, maxX: 610, maxY: 1 }), [])
})

test("undersize rejects preparation instead of shrinking borders", async () => {
  const r = fixture().renderer(), obj = object({ width: 3, height: 4 })
  await assert.rejects(r.prepare([obj]), /minimum width 6.*height 8/)
})
test("exact border minimum keeps fixed corners and omits center", async () => {
  const r = fixture().renderer(), obj = object({ width: 6, height: 8 }); await r.prepare([obj])
  assert.deepEqual(draws(r, obj), [[10,20,2,3,0,0,2,3], [18,20,4,3,2,0,4,3], [10,25,2,5,0,3,2,5], [18,25,4,5,2,3,4,5]])
})
for (const [type, expected] of [
  ["nine", { minWidth: 6, minHeight: 8 }],
  ["horizontal", { minWidth: 6, minHeight: 10, maxHeight: 10 }],
  ["vertical", { minWidth: 12, maxWidth: 12, minHeight: 8 }],
  ["region", { minWidth: 12, maxWidth: 12, minHeight: 10, maxHeight: 10 }],
]) {
  test(`${type} slice limits guard prepare, bounds, draw and resize`, async () => {
    const s = slice(type), f = fixture({ documents: { "panels/ui.json": doc("atlas.png", [s]) } })
    const r = f.renderer(), obj = object({ slice: type, width: expected.maxWidth ?? 20, height: expected.maxHeight ?? 18 })
    assert.deepEqual(f.nineSliceLimits(s), expected)
    assert.throws(() => r.resizeLimits(obj), /not prepared/)
    assert.throws(() => r.resize(obj, { width: 20, height: 18 }), /not prepared/)
    await r.prepare([obj])
    assert.deepEqual(r.resizeLimits(obj), expected)
    const exact = { width: expected.minWidth, height: expected.minHeight }
    if (type === "region") assert.throws(() => r.resize(obj, exact), /region.*resiz/)
    else assert.deepEqual(r.resize(obj, exact), exact)
    const minimum = object({ slice: type, ...exact })
    await r.prepare([minimum])
    assert.ok(draws(r, minimum).length > 0)
    for (const axis of ["width", "height"]) {
      const size = { ...exact, [axis]: exact[axis] - 0.5 }
      const undersize = object({ slice: type, ...size })
      const message = new RegExp(`minimum width ${expected.minWidth}.*height ${expected.minHeight}`)
      await assert.rejects(r.prepare([undersize]), message)
      assert.throws(() => r.bounds(undersize), message)
      assert.throws(() => draws(r, undersize), message)
      assert.throws(() => r.resize(minimum, size), type === "region" ? /region.*resiz/ : message)
      assert.ok(draws(r, minimum).length > 0)
    }
    for (const [axis, maximum] of [["width", expected.maxWidth], ["height", expected.maxHeight]]) {
      if (maximum === undefined) continue
      const size = { ...exact, [axis]: maximum + 0.5 }, oversized = object({ slice: type, ...size })
      const message = /maximum/
      await assert.rejects(r.prepare([oversized]), message)
      assert.throws(() => r.bounds(oversized), message)
      assert.throws(() => draws(r, oversized), message)
      assert.throws(() => r.resize(minimum, size), type === "region" ? /region.*resiz/ : message)
      assert.ok(draws(r, minimum).length > 0)
    }
    for (const size of [null, {}, { width: "12", height: 10 }, { width: 12, height: Infinity }]) {
      assert.throws(() => r.resize(object({ nine: "unprepared.json" }), size), /positive finite/)
    }
    r.dispose()
  })
}
test("undersized staged document preserves old cache and closes staged atlas", async () => {
  const f = fixture({ documents: { "new.json": doc("new.png") } }), r = f.renderer(), old = object()
  await r.prepare([old])
  await assert.rejects(r.prepare([object({ nine: "new.json", width: 5 })]), /minimum width 6.*height 8/)
  assert.equal(f.images[0].closed, 0)
  assert.equal(f.images[1].closed, 1)
  assert.equal(draws(r, old).length, 35)
  assert.throws(() => r.bounds(object({ nine: "new.json" })), /not prepared/)
  r.dispose()
})
for (const type of ["region", "horizontal", "vertical"]) {
  test(`${type} fixed-axis failure preserves old cache and closes staged atlas`, async () => {
    const f = fixture({ documents: { "new.json": doc("new.png", [slice(type)]) } }), r = f.renderer(), old = object()
    await r.prepare([old])
    const size = type === "horizontal" ? { width: 20, height: 11 } : { width: 13, height: 10 }
    await assert.rejects(r.prepare([object({ nine: "new.json", slice: type, ...size })]), /maximum/)
    assert.equal(f.images[0].closed, 0)
    assert.equal(f.images[1].closed, 1)
    assert.equal(draws(r, old).length, 35)
    assert.throws(() => r.bounds(object({ nine: "new.json", slice: type, ...size })), /not prepared/)
    r.dispose()
  })
}
test("origins, bounds, config and object properties", async () => {
  const f = fixture(), origin = [0.5, 1], r = f.renderer({ origin }), obj = object(); origin[0] = 0
  await r.prepare([obj])
  assert.deepEqual(r.bounds(obj), { minX: -10, minY: -18, maxX: 10, maxY: 0 })
  assert.deepEqual(draws(r, obj)[0], [10,20,2,3,-10,-18,2,3])
  for (const config of [null, undefined, [], { origin: [] }, { origin: [0, 2] }, { origin: ["0", 0] }, { origin: [NaN, 0] }])
    assert.throws(() => f.createWorldObjectRenderer({ config }), /config/)
  assert.throws(() => r.draw({}, obj, { scale: 1 }), /2d context/)
  for (const frame of [null, {}, { scale: 0 }, { scale: Infinity }, { scale: "1" }])
    assert.throws(() => r.draw(new Context(), obj, frame), /frame.scale/)
  await assert.rejects(r.prepare(null), /objects must be array/)
  for (const patch of [{ width: true }, { width: [] }, { width: "" }, { height: null }, { width: 0 }, { height: -1 }, { width: Infinity }, { height: "bad" }, { slice: "" }, { nine: "/bad.json" }]) {
    await assert.rejects(r.prepare([object(patch)]), /width|height|slice|Project-relative/)
    assert.throws(() => r.bounds(object(patch)), /width|height|slice|Project-relative/)
  }
})
test("reader validates full v1 schema and retains metadata", async () => {
  const mutations = [
    d => { d.format = "other" }, d => { d.version = "1" }, d => { d.image = "" },
    d => { d.slices = {} }, d => { d.slices.push(slice()) }, d => { d.slices[0].name = " " },
    d => { d.slices[0].type = "unknown" }, d => { delete d.slices[0].center },
    d => { d.slices[0].bounds.x = -1 }, d => { d.slices[0].bounds.width = 0 },
    d => { d.slices[0].bounds.y = 0.5 }, d => { d.slices[0].bounds.x = Number.MAX_SAFE_INTEGER + 1 },
    d => { d.slices[0].center = null }, d => { d.slices[0].center.height = 0 },
    d => { d.slices[0].center.x = 10 }, d => { d.slices[0].center.y = 9 },
    d => { d.slices[0] = { ...slice("region"), center: null } },
    d => { d.slices[0] = slice("horizontal"); d.slices[0].center.height = 9 },
    d => { d.slices[0] = slice("vertical"); d.slices[0].center.width = 11 },
  ]
  for (const mutate of mutations) {
    const d = doc(); mutate(d)
    await assert.rejects(fixture({ documents: { "test.json": d } }).readNineDocument("test.json"))
  }
  for (const path of ["/a", "../a", "a/../b", "./a", "a//b", "a\\b", "https:a", "a/", "", null]) {
    const f = fixture(); await assert.rejects(f.readNineDocument(path), /Project-relative/); assert.equal(f.reads.length, 0)
    await assert.rejects(fixture({ documents: { "a.json": doc(path) } }).readNineDocument("a.json"), /Project-relative/)
  }
  const d = doc("atlas.png", [slice("region"), slice("horizontal"), slice("vertical"), slice()]); d.metadata = { author: "test" }
  const f = fixture({ documents: { "a.json": d } }), result = await f.readNineDocument("a.json")
  assert.deepEqual(result, d); result.slices[0].name = "changed"
  assert.deepEqual(await f.readNineDocument("a.json"), d)
  assert.deepEqual(f.reads.map(([op]) => op), ["fs/fs::read-text", "fs/fs::read-text"])
  assert.deepEqual(await fixture({ documents: { "empty.json": doc("a.png", []) } }).readNineDocument("empty.json"), doc("a.png", []))
})
for (const type of ["nine", "horizontal", "vertical"]) {
  test(`borderless ${type} limits retain one pixel and inactive dimension`, async () => {
    const s = slice(type); s.center = { x: 0, y: 0, width: 12, height: 10 }
    const f = fixture({ documents: { "panels/ui.json": doc("atlas.png", [s]) } }), r = f.renderer()
    const expected = { minWidth: type === "vertical" ? 12 : 1, minHeight: type === "horizontal" ? 10 : 1,
      ...(type === "vertical" ? { maxWidth: 12 } : type === "horizontal" ? { maxHeight: 10 } : {}) }
    assert.deepEqual(f.nineSliceLimits(s), expected)
    const obj = object({ slice: type, width: expected.minWidth, height: expected.minHeight })
    await r.prepare([obj])
    assert.deepEqual(draws(r, obj), [[10,20,expected.minWidth,expected.minHeight,0,0,expected.minWidth,expected.minHeight]])
    r.dispose()
  })
}

test("local Project opens the grouped pause scene with every atlas slice", async () => {
  const root = new URL("../", import.meta.url)
  const config = JSON.parse(await readFile(new URL("gams.json", root), "utf8"))
  const view = config.ui.views["view-world"]
  const explicitSource = config.ui.services["ui-layout"].config.layout.match(/\bdata-source="([^"]+)"/)
  const sourcePath = explicitSource ? explicitSource[1] : view.defaultSource
  assert.equal(sourcePath, "examples/pause.ui.json")
  const world = JSON.parse(await readFile(new URL(sourcePath, root), "utf8"))
  validateSpatial(world)
  const [group, ...children] = world
  assert.deepEqual(group.spatial, { id: "pause-menu", group: true })
  assert(children.every(child => child.spatial.parent === group.spatial.id))
  assert.deepEqual(worldPosition(world, children[0]), { x: group.x + children[0].x, y: group.y + children[0].y })
  const nineChildren = children.filter(child => child.render === view.config.renderers.nine.match.render)
  const textChildren = children.filter(child => child.render === view.config.renderers.text.match.render)
  assert.equal(children.length, nineChildren.length + textChildren.length)
  assert.deepEqual(textChildren.map(child => child.text), ["Continue", "Quit"])
  const objects = nineChildren.map(({ x, y, spatial, ...props }) => ({ x, y, props }))
  const { props } = objects[0]
  assert.equal(typeof props.name, "string")
  assert.equal(props.render, view.config.renderers.nine.match.render)
  const document = JSON.parse(await readFile(new URL(props.nine, root), "utf8"))
  assert.equal(nineChildren.length, document.slices.length)
  assert.deepEqual(new Set(nineChildren.map(child => child.slice)), new Set(document.slices.map(slice => slice.name)))
  const bytes = await readFile(new URL(document.image, root))
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  const f = fixture({
    read: async (op, path) => ({ ok: op.endsWith("read-text")
      ? await readFile(new URL(path, root), "utf8")
      : [...await readFile(new URL(path, root))] }),
    decode: async () => new Bitmap(width, height),
  })
  const renderer = f.renderer(view.config.renderers.nine.config)
  await renderer.prepare(objects)
  for (const object of objects) {
    assert.equal(object.props.render, view.config.renderers.nine.match.render)
    assert.ok(draws(renderer, object).length > 0)
    const limits = renderer.resizeLimits(object)
    assert(object.props.width >= limits.minWidth && object.props.height >= limits.minHeight)
  }
  assert.deepEqual(renderer.resizeLimits({ props }), { minWidth: 641, minHeight: 622 })
  assert.deepEqual(f.nineSliceLimits(document.slices.find(s => s.name === props.slice)), { minWidth: 641, minHeight: 622 })
  assert.deepEqual(renderer.bounds({ props }), { minX: -0, minY: -0, maxX: props.width, maxY: props.height })
  const calls = draws(renderer, { props })
  assert.equal(calls.length, 20)
  assert.deepEqual(calls[0], [26, 155, 232, 297, 0, 0, 232, 297])
  assert.deepEqual(calls[6], [258, 452, 63, 137, 232, 297, 63, 137])
  assert.deepEqual(calls[13], [258, 452, 8, 128, 358, 434, 8, 128])
  renderer.dispose()
})
