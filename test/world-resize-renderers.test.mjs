import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const sources = Object.fromEntries(await Promise.all([
  "world-object-renderers", "world-renderers/nine", "world-renderers/rectangle", "world-renderers/sprite",
].map(async path => [path, await readFile(new URL(`../src/${path}.js`, import.meta.url), "utf8")])))

function baseRenderer(patch = {}) {
  return { async prepare() {}, draw() {}, bounds() {}, dispose() {}, ...patch }
}
const object = (props = {}) => ({ x: 4, y: 8, props })
const descriptor = { url: "custom.js", match: { render: "custom", layer: "1" }, config: {} }
function registryFixture(custom = baseRenderer(), fallback = baseRenderer(), descriptors = { custom: descriptor }) {
  // Adapt only the Host module-loader boundary; execute the real registry.
  const body = sources["world-object-renderers"].replace(/^import .*$/gm, "").replace("export class", "class")
  const Registry = new Function("require", `${body}\nreturn WorldObjectRendererRegistry`)(
    async url => { assert.equal(url, "custom.js"); return { createWorldObjectRenderer: () => custom } },
  )
  return Registry.create({ renderers: descriptors }, fallback)
}
const matching = () => object({ render: "custom", layer: "1" })
const size = Object.freeze({ width: 37.5, height: 19.25 })
const invalidSizes = [null, undefined, {}, { width: 1 }, { height: 2 },
  ...[0, -1, NaN, Infinity, -Infinity, "2", true, null, undefined, [], {}]
    .flatMap(value => [{ width: value, height: 2 }, { width: 2, height: value }])]

function frozenObject(props = {}) {
  return Object.freeze(object(Object.freeze(props)))
}

test("capability follows actual strict matcher, including custom and fallback methods", async () => {
  const registry = await registryFixture(baseRenderer({ resize() {} }))
  assert.equal(registry.canResize(matching()), true)
  for (const props of [{}, { render: "custom" }, { render: "custom", layer: 1 }])
    assert.equal(registry.canResize(object(props)), false)
  const fallbackRegistry = await registryFixture(baseRenderer(), baseRenderer({ resize() {} }))
  assert.equal(fallbackRegistry.canResize(matching()), false)
  assert.equal(fallbackRegistry.canResize(object()), true)
})

test("unsupported matched and point renderers reject resize", async () => {
  const registry = await registryFixture()
  assert.throws(() => registry.resize(matching(), size), /custom does not support resize/)
  assert.throws(() => registry.resize(object(), size), /point does not support resize/)
})

test("present but non-function optional resize fails factory validation for custom and fallback", async () => {
  for (const resize of [undefined, null, false, 1, "resize", {}, []]) {
    await assert.rejects(registryFixture(baseRenderer({ resize })), /custom resize must be a function/)
    await assert.rejects(registryFixture(baseRenderer(), baseRenderer({ resize })), /point resize must be a function/)
  }
})

test("registry dispatch forwards receiver/object/size and returns immutable property patch", async () => {
  for (const matched of [true, false]) {
    const item = frozenObject(matched ? matching().props : { name: "point" })
    const before = structuredClone(item), patch = Object.freeze({ ...size, custom: "kept" })
    let calls = 0
    const renderer = baseRenderer({ resize(givenObject, givenSize) {
      calls++
      assert.equal(this, renderer)
      assert.equal(givenObject, item)
      assert.equal(givenSize, size)
      return patch
    } })
    const registry = await registryFixture(matched ? renderer : baseRenderer(), matched ? baseRenderer() : renderer)
    assert.equal(registry.resize(item, size), patch)
    assert.equal(calls, 1)
    assert.deepEqual(item, before)
  }
})

test("registry rejects invalid sizes before dispatch", async () => {
  let calls = 0
  const registry = await registryFixture(baseRenderer({ resize() { calls++; return {} } }))
  for (const invalid of invalidSizes)
    assert.throws(() => registry.resize(matching(), invalid), /resize (width|height) must be a positive finite number/)
  assert.equal(calls, 0)
})

test("registry requires synchronous plain property patches and propagates renderer failure", async () => {
  const custom = baseRenderer({ resize() {} }), registry = await registryFixture(custom)
  for (const result of [null, undefined, [], 2, "patch", new Date(), new Map(), Promise.resolve({}), new (class Patch {})()]) {
    custom.resize = () => result
    assert.throws(() => registry.resize(matching(), size), /resize must return a plain property patch/)
  }
  const patch = Object.assign(Object.create(null), size)
  custom.resize = () => patch
  assert.equal(registry.resize(matching(), size), patch)
  const failure = new Error("resize failed")
  custom.resize = () => { throw failure }
  assert.throws(() => registry.resize(matching(), size), error => error === failure)
})

test("resize capability and dispatch retain ambiguous-match errors", async () => {
  const registry = await registryFixture(baseRenderer({ resize() {} }), baseRenderer(), { a: descriptor, b: descriptor })
  assert.throws(() => registry.canResize(matching()), /matches multiple renderers: a, b/)
  assert.throws(() => registry.resize(matching(), size), /matches multiple renderers: a, b/)
})

class Bitmap {
  width = 100
  height = 80
  close() {}
}
function rendererFixture(name, origin = [0.5, 1]) {
  // Adapt only Host imports and browser APIs, not renderer logic.
  const body = sources[`world-renderers/${name}`].replace(/^import .*$/gm, "").replace(/^export /gm, "")
  const document = { format: "gams.nine", version: 1, image: "atlas.png", slices: [
    { name: "panel", type: "nine", bounds: { x: 0, y: 0, width: 20, height: 10 }, center: { x: 2, y: 2, width: 16, height: 6 } },
  ] }
  const factory = new Function("runtime", "unwrap", "createImageBitmap", "ImageBitmap", "CSS", `${body}\nreturn createWorldObjectRenderer`)(
    { async invoke(op) { return { ok: op.endsWith("read-text") ? JSON.stringify(document) : [1, 2, 3] } } },
    result => result.ok, async () => new Bitmap(), Bitmap, { supports: () => true },
  )
  return factory({ config: { origin } })
}
const propsFor = name => name === "nine"
  ? { nine: "panels.json", slice: "panel", width: 20, height: 10 }
  : { color: "red", width: 20, height: 10 }

for (const name of ["nine", "rectangle", "sprite"]) {
  test(`${name} resize returns fresh numeric dimensions without mutating object or size`, async () => {
    const renderer = rendererFixture(name), item = frozenObject(propsFor(name)), before = structuredClone(item)
    await renderer.prepare([item])
    const patch = renderer.resize(item, size)
    assert.deepEqual(patch, size)
    assert.notEqual(patch, size)
    assert.deepEqual(item, before)
    assert.deepEqual(renderer.bounds(item), { minX: -10, minY: -10, maxX: 10, maxY: 0 })
    const resized = { ...item, props: { ...item.props, ...patch } }
    await renderer.prepare([resized])
    assert.deepEqual(renderer.bounds(resized), { minX: -18.75, minY: -19.25, maxX: 18.75, maxY: 0 })
    patch.width = 1
    assert.equal(item.props.width, 20)
    renderer.dispose()
  })
  test(`${name} resize rejects all invalid sizes directly`, () => {
    const renderer = rendererFixture(name), item = frozenObject(propsFor(name))
    for (const invalid of invalidSizes)
      assert.throws(() => renderer.resize(item, invalid), /resize (width|height) must be a positive finite number/)
    renderer.dispose()
  })
}

test("sprite natural image gains explicit dimensions through resize without changing source object", async () => {
  const renderer = rendererFixture("sprite"), item = frozenObject({ url: "hero.png" })
  await renderer.prepare([item])
  assert.deepEqual(renderer.bounds(item), { minX: -50, minY: -80, maxX: 50, maxY: 0 })
  const patch = renderer.resize(item, size)
  assert.deepEqual(patch, size)
  assert.deepEqual(item.props, { url: "hero.png" })
  const resized = { ...item, props: { ...item.props, ...patch } }
  await renderer.prepare([resized])
  assert.deepEqual(renderer.bounds(resized), { minX: -18.75, minY: -19.25, maxX: 18.75, maxY: 0 })
  renderer.dispose()
})

test("per-object resize limits dispatch to matched renderers and default to one pixel", async () => {
  const registry = await registryFixture(baseRenderer({ resize() {}, resizeLimits(obj) { return obj.props.large ? { minWidth: 18, minHeight: 25 } : { minWidth: 4, minHeight: 7 } } }))
  assert.deepEqual(registry.resizeLimits(matching()), { minWidth: 4, minHeight: 7 })
  assert.deepEqual(registry.resizeLimits(object({ ...matching().props, large: true })), { minWidth: 18, minHeight: 25 })
  assert.deepEqual(registry.resizeLimits(object()), { minWidth: 1, minHeight: 1 })
  const ordinary = await registryFixture(baseRenderer({ resize() {} }))
  assert.deepEqual(ordinary.resizeLimits(matching()), { minWidth: 1, minHeight: 1 })
})

test("malformed optional minimum providers and limit values fail loudly", async () => {
  for (const resizeLimits of [undefined, null, false, {}, 2])
    await assert.rejects(registryFixture(baseRenderer({ resizeLimits })), /resizeLimits must be a function/)
  for (const result of [null, [], {}, { minWidth: 0, minHeight: 1 }, { minWidth: 1, minHeight: -1 }, { minWidth: NaN, minHeight: 1 }, { minWidth: 1, minHeight: "2" }, { minWidth: Infinity, minHeight: 1 }, Promise.resolve({ minWidth: 1, minHeight: 1 })]) {
    const registry = await registryFixture(baseRenderer({ resizeLimits: () => result }))
    assert.throws(() => registry.resizeLimits(matching()), /resize limits/)
  }
})

test("registry preserves maximum limits, suppresses fully fixed objects and rejects maximum violations", async () => {
  let calls = 0
  const custom = baseRenderer({ resize() { calls++; return {} }, resizeLimits: () => ({ minWidth: 10, minHeight: 20, maxWidth: 50, maxHeight: 20 }) })
  const registry = await registryFixture(custom)
  assert.deepEqual(registry.resizeLimits(matching()), { minWidth: 10, minHeight: 20, maxWidth: 50, maxHeight: 20 })
  assert.equal(registry.canResize(matching()), true)
  assert.throws(() => registry.resize(matching(), { width: 51, height: 20 }), /maximum/)
  assert.throws(() => registry.resize(matching(), { width: 50, height: 21 }), /maximum/)
  assert.equal(calls, 0)
  custom.resizeLimits = () => ({ minWidth: 10, minHeight: 20, maxWidth: 10, maxHeight: 20 })
  assert.equal(registry.canResize(matching()), false)
  assert.throws(() => registry.resize(matching(), { width: 10, height: 20 }), /does not support resize/)
})

test("registry rejects malformed maximum limits and maxima below minima", async () => {
  for (const patch of [{ maxWidth: undefined }, { maxHeight: null }, { maxWidth: Infinity }, { maxWidth: "10" }, { maxHeight: 0 }, { maxWidth: 9 }, { maxHeight: 19 }]) {
    const registry = await registryFixture(baseRenderer({ resize() {}, resizeLimits: () => ({ minWidth: 10, minHeight: 20, ...patch }) }))
    assert.throws(() => registry.resizeLimits(matching()), /resize limits/)
  }
})
