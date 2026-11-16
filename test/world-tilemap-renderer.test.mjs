import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(
  new URL("../src/world-renderers/tilemap.js", import.meta.url),
  "utf8",
)
const worldSource = await readFile(
  new URL("../src/views/view-world.js", import.meta.url),
  "utf8",
)
const calls = []
class FakeCanvasRenderingContext2D {
  constructor() {
    this.drawCalls = []
    this.imageSmoothingEnabled = true
  }

  drawImage(...args) {
    this.drawCalls.push(args)
  }
}
const loadTilemapRaster = async (path, options) => {
  calls.push({ path, options })
  return { canvas: {}, width: 64, height: 32 }
}
const moduleSource = source.replace(
  'import { loadTilemapRaster } from "/util/tilemap-render.js"',
  "",
)
// Replace only the Host raster loader import and browser context constructor.
const createWorldObjectRenderer = new Function(
  "loadTilemapRaster", "CanvasRenderingContext2D",
  `${moduleSource.replace("export function", "function")}\nreturn createWorldObjectRenderer`,
)(loadTilemapRaster, FakeCanvasRenderingContext2D)

function object(tilemap, { layer, repeat } = {}) {
  const props = { tilemap }
  if (layer !== undefined) props.layer = layer
  if (repeat !== undefined) props.repeat = repeat
  return { x: 0, y: 0, props }
}

test.beforeEach(() => calls.splice(0))

test("view-world passes object-local viewport bounds to renderers", () => {
  assert.match(worldSource, /viewport: \{/)
  assert.match(worldSource, /minX: viewport\.minX - anchor\.x/)
  assert.match(worldSource, /maxY: viewport\.maxY - anchor\.y/)
})

test("tilemap renderer renders all layers when layer is omitted", async () => {
  const renderer = createWorldObjectRenderer({ config: {} })
  await renderer.prepare([object("maps/level.tilemap.json")])

  assert.deepEqual(calls, [
    {
      path: "maps/level.tilemap.json",
      options: { layer: undefined },
    },
  ])
  assert.deepEqual(renderer.bounds(object("maps/level.tilemap.json")), {
    minX: -0,
    minY: -0,
    maxX: 64,
    maxY: 32,
  })
})

test("tilemap renderer caches each one-based layer separately", async () => {
  const renderer = createWorldObjectRenderer({ config: {} })
  await renderer.prepare([
    object("maps/level.tilemap.json", { layer: 1 }),
    object("maps/level.tilemap.json", { layer: 2 }),
  ])
  await renderer.prepare([
    object("maps/level.tilemap.json", { layer: 2 }),
  ])

  assert.deepEqual(calls, [
    { path: "maps/level.tilemap.json", options: { layer: 1 } },
    { path: "maps/level.tilemap.json", options: { layer: 2 } },
  ])
  assert.deepEqual(
    renderer.bounds(object("maps/level.tilemap.json", { layer: 2 })),
    { minX: -0, minY: -0, maxX: 64, maxY: 32 },
  )
  assert.throws(
    () =>
      renderer.bounds(object("maps/level.tilemap.json", { layer: 1 })),
    /raster not prepared/,
  )
})

test("tilemap renderer rejects invalid layer values", async () => {
  const renderer = createWorldObjectRenderer({ config: {} })

  await assert.rejects(
    renderer.prepare([object("maps/level.tilemap.json", { layer: 0 })]),
    /layer must be a positive integer/,
  )
  await assert.rejects(
    renderer.prepare([object("maps/level.tilemap.json", { layer: "1" })]),
    /layer must be a positive integer/,
  )
})

test("tilemap renderer repeats enabled axes across the viewport", async () => {
  const renderer = createWorldObjectRenderer({
    config: { origin: [0.5, 0.5] },
  })
  const repeated = object("maps/level.tilemap.json", { repeat: [1, 0] })
  await renderer.prepare([repeated])

  assert.deepEqual(renderer.bounds(repeated), {
    minX: -32,
    minY: -16,
    maxX: 32,
    maxY: 16,
  })

  const ctx = new FakeCanvasRenderingContext2D()
  renderer.draw(ctx, repeated, {
    scale: 1,
    viewport: { minX: -100, minY: -60, maxX: 100, maxY: 60 },
  })
  assert.equal(ctx.imageSmoothingEnabled, false)
  assert.deepEqual(
    ctx.drawCalls.map(([, x, y]) => [x, y]),
    [
      [-160, -16],
      [-96, -16],
      [-32, -16],
      [32, -16],
      [96, -16],
    ],
  )
})

test("tilemap renderer rejects invalid repeat flags", async () => {
  const renderer = createWorldObjectRenderer({ config: {} })
  await renderer.prepare([object("maps/level.tilemap.json")])

  for (const repeat of [[1], [-1, 0], [2, 0], ["1", 0]]) {
    const invalid = object("maps/level.tilemap.json", { repeat })
    assert.throws(() => renderer.bounds(invalid), /tilemap renderer repeat/)
  }
})

test("tilemap validates config, origin, object collection and source paths", async () => {
  for (const config of [null, [], { origin: [] }, { origin: [0, Infinity] }, { origin: [-1, 0] }, { origin: [0, "1"] }])
    assert.throws(() => createWorldObjectRenderer({ config }), /config/)
  const renderer = createWorldObjectRenderer({ config: {} })
  await assert.rejects(renderer.prepare(null), /objects must be array/)
  for (const path of [undefined, null, "", 12])
    await assert.rejects(renderer.prepare([object(path)]), /non-empty tilemap/)
  for (const repeat of [[1], [0, -1], ["1", 0]])
    await assert.rejects(renderer.prepare([object("map.json", { repeat })]), /repeat/)
  assert.deepEqual(calls, [])
})

test("tilemap requires preparation, valid context/scale/viewport and clears cached rasters", async () => {
  const renderer = createWorldObjectRenderer({ config: {} }), item = object("map.json")
  const ctx = new FakeCanvasRenderingContext2D()
  const viewport = { minX: 0, minY: 0, maxX: 64, maxY: 32 }
  assert.throws(() => renderer.bounds(item), /raster not prepared/)
  assert.throws(() => renderer.draw(ctx, item, { scale: 1, viewport }), /raster not prepared/)
  await renderer.prepare([item, item])
  assert.equal(calls.length, 1)
  assert.throws(() => renderer.draw({}, item, { scale: 1, viewport }), /requires 2d context/)
  for (const scale of [0, -1, Infinity, "1"])
    assert.throws(() => renderer.draw(ctx, item, { scale, viewport }), /frame.scale/)
  for (const invalid of [undefined, [], ...Object.keys(viewport).map(field => ({ ...viewport, [field]: NaN }))])
    assert.throws(() => renderer.draw(ctx, item, { scale: 1, viewport: invalid }), /frame.viewport/)
  renderer.draw(ctx, item, { scale: 1, viewport })
  assert.equal(ctx.drawCalls.length, 1)
  renderer.dispose()
  assert.throws(() => renderer.bounds(item), /raster not prepared/)
  await renderer.prepare([item])
  assert.equal(calls.length, 2)
  await renderer.prepare([])
  assert.throws(() => renderer.bounds(item), /raster not prepared/)
})

test("tilemap repeats vertically and on both axes using local viewport coordinates", async () => {
  const renderer = createWorldObjectRenderer({ config: {} })
  const item = object("map.json", { repeat: [0, 1] })
  await renderer.prepare([item])
  const ctx = new FakeCanvasRenderingContext2D(), viewport = { minX: -1, minY: -1, maxX: 1, maxY: 33 }
  renderer.draw(ctx, item, { scale: 1, viewport })
  assert.deepEqual(ctx.drawCalls.map(([, x, y]) => [x, y]), [[0, -32], [0, 0], [0, 32]])
  ctx.drawCalls = []
  renderer.draw(ctx, object("map.json", { repeat: [1, 1] }), { scale: 1, viewport })
  assert.deepEqual(ctx.drawCalls.map(([, x, y]) => [x, y]), [[-64, -32], [0, -32], [-64, 0], [0, 0], [-64, 32], [0, 32]])
})
