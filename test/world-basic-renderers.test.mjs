import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const sources = Object.fromEntries(await Promise.all(["rectangle", "sprite"].map(async name =>
  [name, await readFile(new URL(`../src/world-renderers/${name}.js`, import.meta.url), "utf8")])))
class Context {
  calls = []
  fillRect(...args) { this.calls.push(["fillRect", ...args]) }
  strokeRect(...args) { this.calls.push(["strokeRect", ...args]) }
  drawImage(...args) { this.calls.push(["drawImage", ...args]) }
  putImageData(...args) { this.calls.push(["putImageData", ...args]) }
}
class Bitmap {
  width = 40
  height = 20
  closed = 0
  close() { this.closed++ }
}
function fixture(name, read = async () => ({ ok: [1, 2, 3] })) {
  const reads = [], images = [], blobs = [], canvases = []
  // Adapt only browser APIs and the runtime/QOI Host imports.
  const body = sources[name].replace(/^import .*$/gm, "").replace("export function", "function")
  const factory = new Function("runtime", "unwrap", "decodeQoi", "CanvasRenderingContext2D", "ImageBitmap", "CSS", "createImageBitmap", "document", "ImageData",
    `${body}\nreturn createWorldObjectRenderer`)(
    { async invoke(...args) { reads.push(args); return await read(...args) } },
    result => { if (Object.hasOwn(result, "err")) throw new Error(result.err); return result.ok },
    () => ({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }), Context, Bitmap,
    { supports: (property, color) => property === "color" && ["red", "#abc"].includes(color) },
    async blob => { blobs.push(blob); const image = new Bitmap(); images.push(image); return image },
    { createElement(tag) { assert.equal(tag, "canvas"); const ctx = new Context(); const canvas = { getContext: () => ctx, ctx }; canvases.push(canvas); return canvas } },
    class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }) } },
  )
  return { factory, reads, images, blobs, canvases }
}
const rectangle = (patch = {}) => ({ props: { width: "12", height: 8, color: "red", ...patch } })
const image = (url = "art/hero.png", patch = {}) => ({ props: { url, ...patch } })

for (const name of ["rectangle", "sprite"]) {
  test(`${name} validates configuration and origins`, () => {
    const { factory } = fixture(name)
    for (const config of [null, [], undefined, { origin: [] }, { origin: [-1, 0] }, { origin: [0, 2] }, { origin: [NaN, 0] }, { origin: ["0", 0] }])
      assert.throws(() => factory({ config }), /config/)
  })
  test(`${name} rectangle bounds and draw use copied origins and scaled outlines`, async () => {
    const { factory } = fixture(name), origin = [0.5, 1]
    const renderer = factory({ config: { origin } })
    origin[0] = 0
    const object = rectangle(), ctx = new Context()
    await renderer.prepare([object])
    assert.deepEqual(renderer.bounds(object), { minX: -6, minY: -8, maxX: 6, maxY: 0 })
    renderer.draw(ctx, object, { scale: 4 })
    assert.deepEqual(ctx.calls, [["fillRect", -6, -8, 12, 8], ["strokeRect", -6, -8, 12, 8]])
    assert.equal(ctx.fillStyle, "red")
    assert.equal(ctx.strokeStyle, "rgba(255,255,255,0.9)")
    assert.equal(ctx.lineWidth, 0.25)
    assert.deepEqual(factory({ config: {} }).bounds(object), { minX: -0, minY: -0, maxX: 12, maxY: 8 })
    renderer.dispose()
  })
  test(`${name} rejects malformed rectangle data and invalid context/scale`, async () => {
    const renderer = fixture(name).factory({ config: {} })
    await assert.rejects(renderer.prepare(null), /objects must be array/)
    for (const patch of [{ width: 0 }, { height: -1 }, { width: "no" }, { height: Infinity }, { color: "" }, { color: 4 }, { color: "invalid" }, { width: undefined }, { height: undefined }]) {
      const object = rectangle(patch)
      await assert.rejects(renderer.prepare([object]), /width|height|color/)
      assert.throws(() => renderer.bounds(object), /width|height|color/)
      assert.throws(() => renderer.draw(new Context(), object, { scale: 1 }), /width|height|color/)
    }
    assert.throws(() => renderer.draw({}, rectangle(), { scale: 1 }), /requires 2d context/)
    for (const frame of [null, {}, { scale: 0 }, { scale: -1 }, { scale: Infinity }, { scale: "1" }])
      assert.throws(() => renderer.draw(new Context(), rectangle(), frame), /frame.scale/)
  })
}

test("sprite uses natural/overridden dimensions, origin and nearest-neighbor drawing", async () => {
  const f = fixture("sprite"), renderer = f.factory({ config: { origin: [0.5, 1] } })
  const object = image(), scaled = image("art/hero.png", { width: "16", height: 12 })
  assert.throws(() => renderer.bounds(object), /image not prepared/)
  assert.throws(() => renderer.draw(new Context(), object, { scale: 1 }), /image not prepared/)
  await renderer.prepare([object, scaled])
  assert.deepEqual(f.reads, [["fs/fs::read-file", "art/hero.png"]])
  assert.equal(f.blobs[0].type, "image/png")
  assert.deepEqual([...new Uint8Array(await f.blobs[0].arrayBuffer())], [1, 2, 3])
  assert.deepEqual(renderer.bounds(object), { minX: -20, minY: -20, maxX: 20, maxY: 0 })
  assert.deepEqual(renderer.bounds(scaled), { minX: -8, minY: -12, maxX: 8, maxY: 0 })
  const ctx = new Context()
  renderer.draw(ctx, scaled, { scale: 2 })
  assert.equal(ctx.imageSmoothingEnabled, false)
  assert.deepEqual(ctx.calls, [["drawImage", f.images[0], -8, -12, 16, 12]])
})

test("sprite caches URLs, evicts unused images and closes sources once", async () => {
  const f = fixture("sprite"), renderer = f.factory({ config: {} }), a = image(), b = image("art/b.png")
  await renderer.prepare([a, a, b])
  await renderer.prepare([a, b])
  assert.equal(f.reads.length, 2)
  await renderer.prepare([b])
  assert.deepEqual(f.images.map(source => source.closed), [1, 0])
  assert.throws(() => renderer.bounds(a), /image not prepared/)
  renderer.dispose()
  renderer.dispose()
  assert.deepEqual(f.images.map(source => source.closed), [1, 1])
  assert.throws(() => renderer.bounds(b), /image not prepared/)
})

test("sprite load failure closes staged images but preserves previous cache", async () => {
  const failure = new Error("read failed")
  const f = fixture("sprite", async (_operation, path) => { if (path === "bad.png") throw failure; return { ok: [1] } })
  const renderer = f.factory({ config: {} }), old = image("old.png")
  await renderer.prepare([old])
  await assert.rejects(renderer.prepare([image("new.png"), image("bad.png")]), error => error === failure)
  assert.deepEqual(f.images.map(source => source.closed), [0, 1])
  assert.equal(renderer.bounds(old).maxX, 40)
  assert.throws(() => renderer.bounds(image("new.png")), /image not prepared/)
  renderer.dispose()
  assert.deepEqual(f.images.map(source => source.closed), [1, 1])
})

test("sprite rejects malformed URLs, dimensions, FS failures and unsupported formats", async () => {
  const f = fixture("sprite"), renderer = f.factory({ config: {} })
  for (const url of [null, "", 1]) await assert.rejects(renderer.prepare([image(url)]), /url property/)
  assert.deepEqual(f.reads, [])
  for (const patch of [{ width: 1 }, { height: 2 }, { width: 0, height: 1 }, { width: 1, height: NaN }])
    await assert.rejects(renderer.prepare([image("art/hero.png", patch)]), /width|height/)
  for (const url of ["art/hero.svg", "art/hero", "art/"])
    await assert.rejects(renderer.prepare([image(url)]), /extension|filename/)
  const badFS = fixture("sprite", async () => ({ err: "missing image" })).factory({ config: {} })
  await assert.rejects(badFS.prepare([image()]), /missing image/)
})

test("sprite recognizes all browser image MIME types case-insensitively", async () => {
  const f = fixture("sprite"), renderer = f.factory({ config: {} })
  const formats = { PNG: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", gif: "gif", bmp: "bmp" }
  await renderer.prepare(Object.keys(formats).map(ext => image(`art/hero.${ext}`)))
  assert.deepEqual(f.blobs.map(blob => blob.type), Object.values(formats).map(type => `image/${type}`))
})

test("sprite QOI uploads pixels to a canvas and needs no bitmap cleanup", async () => {
  const f = fixture("sprite"), renderer = f.factory({ config: {} }), object = image("art/hero.qoi")
  await renderer.prepare([object])
  assert.equal(f.blobs.length, 0)
  const canvas = f.canvases[0], [method, pixels, x, y] = canvas.ctx.calls[0]
  assert.equal(method, "putImageData")
  assert.deepEqual([...pixels.data], [1, 2, 3, 255])
  assert.deepEqual([pixels.width, pixels.height, x, y, canvas.width, canvas.height], [1, 1, 0, 0, 1, 1])
  const ctx = new Context()
  renderer.draw(ctx, object, { scale: 1 })
  assert.equal(ctx.calls[0][1], canvas)
  await renderer.prepare([])
  renderer.dispose()
})
