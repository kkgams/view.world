import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../src/world-object-renderers.js", import.meta.url), "utf8")
class Context {
  calls = []
  save() { this.calls.push(["save"]) }
  translate(...args) { this.calls.push(["translate", ...args]) }
  restore() { this.calls.push(["restore"]) }
}
function renderer() {
  const calls = []
  return {
    calls,
    async prepare(objects) { calls.push(["prepare", objects]) },
    draw(...args) { calls.push(["draw", ...args]) },
    bounds() { return { minX: -1, minY: -2, maxX: 3, maxY: 4 } },
    dispose() { calls.push(["dispose"]) },
  }
}
function fixture(modules = {}) {
  const loads = []
  // Only adapt the Host module-loader import and browser context type.
  const Registry = new Function("require", "CanvasRenderingContext2D",
    `${source.replace('import { require } from "/util/require.js"', "").replace("export class", "class")}\nreturn WorldObjectRendererRegistry`)(
    async path => { loads.push(path); if (modules[path] instanceof Error) throw modules[path]; return modules[path] }, Context)
  return { Registry, loads }
}
const descriptor = (match = { kind: "box" }, config = {}) => ({ url: "renderers/box.js", match, config })
const object = (props = {}, x = 12, y = -8) => ({ props, x, y })

test("registry loads configured factories, matches every property strictly, and falls back to point", async () => {
  const box = renderer(), fallback = renderer(), config = { origin: [0.5, 1] }, seen = []
  const f = fixture({ "renderers/box.js": { createWorldObjectRenderer(args) { seen.push(args); return box } } })
  const registry = await f.Registry.create({ renderers: { box: descriptor({ kind: "box", layer: "1" }, config) } }, fallback)
  assert.deepEqual(f.loads, ["renderers/box.js"])
  assert.deepEqual(seen, [{ config }])
  assert.deepEqual(registry.rendererForObject(object({ kind: "box", layer: "1" })), { id: "box", renderer: box })
  for (const props of [{}, { kind: "box" }, { kind: "box", layer: 1 }])
    assert.deepEqual(registry.rendererForObject(object(props)), { id: "point", renderer: fallback })
})

test("registry prepares each group including empty groups and disposes every renderer", async () => {
  const box = renderer(), fallback = renderer()
  const { Registry } = fixture({ "renderers/box.js": { createWorldObjectRenderer: () => box } })
  const registry = await Registry.create({ renderers: { box: descriptor() } }, fallback)
  const a = object({ kind: "box" }), b = object()
  await registry.prepare([a, b])
  await registry.prepare([])
  assert.deepEqual(box.calls, [["prepare", [a]], ["prepare", []]])
  assert.deepEqual(fallback.calls, [["prepare", [b]], ["prepare", []]])
  await assert.rejects(registry.prepare(null), /objects must be array/)
  registry.dispose()
  assert.deepEqual(box.calls.at(-1), ["dispose"])
  assert.deepEqual(fallback.calls.at(-1), ["dispose"])
  assert.deepEqual(registry.records, [])
})

test("registry rejects ambiguity before preparation and identifies the object", async () => {
  const fallback = renderer(), box = renderer()
  const { Registry } = fixture({ "renderers/box.js": { createWorldObjectRenderer: () => box } })
  const registry = await Registry.create({ renderers: { a: descriptor(), b: descriptor() } }, fallback)
  for (const props of [{ name: "crate" }, { id: "42" }, {}]) {
    const item = object({ kind: "box", ...props })
    assert.throws(() => registry.bounds(item), /matches multiple renderers: a, b/)
    await assert.rejects(registry.prepare([item]), /matches multiple renderers/)
    assert.equal(registry.objectLabel(item), props.name || props.id || "at (12, -8)")
  }
  assert.deepEqual(fallback.calls, [])
  assert.deepEqual(box.calls, [])
})

test("registry validates configuration, module exports and the full renderer interface", async () => {
  const { Registry } = fixture({ "renderers/box.js": {} })
  const invalid = [null, [], {}, { renderers: [] }, { renderers: { "": descriptor() } },
    { renderers: { box: null } }, ...[
      { url: "" }, { match: {} }, { match: { "": "x" } }, { match: { kind: 1 } }, { config: [] },
    ].map(patch => ({ renderers: { box: { ...descriptor(), ...patch } } }))]
  for (const config of invalid) await assert.rejects(Registry.create(config, renderer()), /config|renderer|match/)
  await assert.rejects(Registry.create({ renderers: { box: descriptor() } }, renderer()), /must export createWorldObjectRenderer/)
  for (const value of [null, [], ...["prepare", "draw", "bounds", "dispose"].map(method => ({ ...renderer(), [method]: undefined }))]) {
    await assert.rejects(Registry.create({ renderers: {} }, value), /factory must return|must implement/)
    const f = fixture({ "renderers/box.js": { createWorldObjectRenderer: () => value } })
    await assert.rejects(f.Registry.create({ renderers: { box: descriptor() } }, renderer()), /factory must return|must implement/)
  }
  const failure = new Error("read failed")
  const f = fixture({ "renderers/box.js": failure })
  await assert.rejects(f.Registry.create({ renderers: { box: descriptor() } }, renderer()), error => error === failure)
})

test("registry validates local bounds without translating them", async () => {
  const fallback = renderer(), { Registry } = fixture()
  const registry = await Registry.create({ renderers: {} }, fallback)
  assert.deepEqual(registry.bounds(object()), { minX: -1, minY: -2, maxX: 3, maxY: 4 })
  const valid = fallback.bounds()
  for (const bounds of [null, [], ...Object.keys(valid).map(key => ({ ...valid, [key]: Infinity })),
    { ...valid, maxX: -1 }, { ...valid, maxX: -2 }, { ...valid, maxY: -2 }, { ...valid, maxY: -3 }]) {
    fallback.bounds = () => bounds
    assert.throws(() => registry.bounds(object()), /bounds/)
  }
})

test("registry draw saves, translates once, forwards identity and restores even on failure", async () => {
  const fallback = renderer(), { Registry } = fixture()
  const registry = await Registry.create({ renderers: {} }, fallback)
  const item = object(), frame = { scale: 2 }, ctx = new Context()
  registry.draw(ctx, item, frame)
  assert.deepEqual(ctx.calls, [["save"], ["translate", 12, -8], ["restore"]])
  assert.deepEqual(fallback.calls, [["draw", ctx, item, frame]])
  const failure = new Error("draw failed")
  fallback.draw = () => { throw failure }
  assert.throws(() => registry.draw(ctx, item, frame), error => error === failure)
  assert.deepEqual(ctx.calls.slice(-3), [["save"], ["translate", 12, -8], ["restore"]])
  assert.throws(() => registry.draw({}, item, frame), /requires 2d context/)
})

test("registry routes drawing/bounds to the selected renderer and propagates prepare failure", async () => {
  const box = renderer(), fallback = renderer(), failure = new Error("prepare failed")
  const { Registry } = fixture({ "renderers/box.js": { createWorldObjectRenderer: () => box } })
  const registry = await Registry.create({ renderers: { box: descriptor() } }, fallback)
  const item = object({ kind: "box" }), ctx = new Context(), frame = { scale: 1 }
  box.bounds = () => ({ minX: 0, minY: 0, maxX: 10, maxY: 20 })
  assert.deepEqual(registry.bounds(item), { minX: 0, minY: 0, maxX: 10, maxY: 20 })
  registry.draw(ctx, item, frame)
  assert.deepEqual(box.calls, [["draw", ctx, item, frame]])
  assert.deepEqual(fallback.calls, [])
  box.prepare = async () => { throw failure }
  await assert.rejects(registry.prepare([item]), error => error === failure)
})
