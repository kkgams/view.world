import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
const modelSource = await readFile(new URL("../src/text-model.js", import.meta.url), "utf8")
const model = await import(`data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}`)
const source = await readFile(new URL("../src/world-renderers/text.js", import.meta.url), "utf8")
const doc = () => ({
  format: "gams.font", version: 1, image: "fonts/test.png",
  atlas: { width: 16, height: 16, size: 32, distanceRange: 4, distanceRangeMiddle: 0, type: "mtsdf", yOrigin: "bottom" },
  metrics: { emSize: 1, lineHeight: 1.2, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    { unicode: 65, advance: 0.6, planeBounds: { left: -0.1, right: 0.6, bottom: -0.2, top: 0.9 }, atlasBounds: { left: 0, right: 7, bottom: 0, top: 11 } },
    { unicode: 86, advance: 0.6, planeBounds: { left: 0, right: 0.6, bottom: 0, top: 0.8 }, atlasBounds: { left: 8, right: 14, bottom: 0, top: 8 } },
    { unicode: 0x1f600, advance: 1 },
  ], kerning: [{ unicode1: 65, unicode2: 86, advance: -0.1 }],
})
const obj = (patch = {}) => ({ props: { render: "text", font: "fonts/test.font.json", text: "AV", fontSize: 20, color: "#ff800080", ...patch } })
class Context {}
function fixture() {
  const f = { documents: {}, images: [], reads: [], draws: [], disposals: 0 }
  const runtime = { async invoke(op, path) {
    f.reads.push([op, path]); if (f.read) { const result = await f.read(op, path); if (result !== undefined) return { ok: result } }
    return { ok: op.endsWith("read-text") ? JSON.stringify(f.documents[path] || doc()) : [1, 2] }
  } }
  const exports = new Function("runtime", "unwrap", ...Object.keys(model), "createTextRaster", "createImageBitmap", "CanvasRenderingContext2D",
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") + "\nreturn { createWorldObjectRenderer, readFontDocument }")(
    runtime, result => result.ok, ...Object.values(model), () => ({ draw(...args) { f.draws.push(args) }, dispose() { f.disposals++ } }),
    async (blob, options) => {
      if (f.decode) await f.decode()
      const image = { width: f.width ?? 16, height: 16, closed: 0, close() { this.closed++ } }
      f.images.push({ image, blob, options }); return image
    }, Context)
  Object.assign(f, exports)
  f.renderer = exports.createWorldObjectRenderer({ config: {} })
  return f
}

test("font model validates linked schema, paths, bounds, scalars and pairs", () => {
  assert.deepEqual(model.validateFontDocument(doc()), doc())
  const mutations = [
    d => d.version = 2, d => d.format = "other", d => d.image = "../a.png", d => d.image = "a.jpg",
    d => d.atlas.yOrigin = "top", d => d.atlas.distanceRangeMiddle = 1, d => d.atlas.width = 0,
    d => d.atlas.distanceRange = Infinity, d => d.metrics.emSize = 0, d => d.metrics.lineHeight = -1,
    d => d.metrics.ascender = -1, d => d.glyphs.push(d.glyphs[0]), d => d.glyphs[0].unicode = 0xd800,
    d => d.glyphs[0].advance = -1, d => delete d.glyphs[1].atlasBounds,
    d => d.glyphs[1].planeBounds.top = -0.2, d => d.glyphs[1].atlasBounds.right = 17,
    d => d.kerning.push(d.kerning[0]), d => d.kerning[0].unicode1 = 100, d => d.kerning[0].advance = NaN,
  ]
  for (const mutate of mutations) { const d = doc(); mutate(d); assert.throws(() => model.validateFontDocument(d)) }
  for (const path of [null, "", "/a", "a/", "a//b", "./a", "a/../b", "a\\b", "http:a", "a\u0000.png"])
    assert.throws(() => model.fontProjectPath(path), /Project-relative/)
})
test("kerning, negative bearings, multiline, spaces, Unicode and PNG UV coordinates", () => {
  const d = doc(), l = model.layoutWorldText(d, "AV", 20)
  assert.deepEqual(l.bounds, { minX: 0, minY: 0, maxX: 24, maxY: 26 })
  assert.deepEqual(l.quads[0], { x: 0, y: 0, width: 14, height: 22, uv: [0, 5/16, 7/16, 11/16] })
  assert.deepEqual(l.quads[1], { x: 12, y: 2, width: 12, height: 16, uv: [0.5, 0.5, 6/16, 0.5] })
  assert.equal(model.layoutWorldText(d, "A\nV\n", 20).bounds.maxY, 74)
  assert.deepEqual(model.layoutWorldText(d, "A\r\nV", 20), model.layoutWorldText(d, "A\nV", 20))
  const centered = model.layoutWorldText(d, "AV", 20, [0.5, 1])
  assert.deepEqual(centered.bounds, { minX: -12, minY: -26, maxX: 12, maxY: 0 })
  assert.equal(model.layoutWorldText(d, "  ", 20).bounds.maxX, 10)
  assert.equal(model.layoutWorldText(d, "😀", 20).bounds.maxX, 20)
  assert.deepEqual(model.layoutWorldText(d, "", 20).bounds, { minX: 0, minY: 0, maxX: 1, maxY: 24 })
  assert.throws(() => model.layoutWorldText(d, "B", 20), /missing glyph U\+0042/)
  assert.throws(() => model.layoutWorldText(d, "\ud800", 20), /surrogate/)
  assert.throws(() => model.layoutWorldText(d, "AV", Number.MAX_VALUE), /finite dimensions/)
  const twice = doc(); twice.metrics.emSize = 2
  assert.equal(model.layoutWorldText(twice, "  ", 20).bounds.maxX, 5)
})
test("prepares referenced fonts once, preserves channels, draws and disposes", async () => {
  const f = fixture(), r = f.renderer, a = obj()
  assert.throws(() => r.bounds(a), /not prepared/)
  await r.prepare([a, a]); await r.prepare([a])
  assert.equal(f.reads.length, 2); assert.equal(f.images.length, 1)
  assert.deepEqual(f.images[0].options, { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none" })
  assert.equal(f.images[0].blob.type, "image/png")
  assert.deepEqual([...new Uint8Array(await f.images[0].blob.arrayBuffer())], [1, 2])
  const ctx = new Context(); r.draw(ctx, a, { scale: 2 })
  const [actualContext, layout, font, color] = f.draws[0]
  assert.equal(actualContext, ctx); assert.deepEqual(layout.bounds, r.bounds(a)); assert.equal(font.image, f.images[0].image)
  assert.deepEqual(color, [1, 128/255, 0, 128/255])
  r.draw(ctx, obj({ text: " " }), { scale: 1 }); assert.equal(f.draws.length, 1)
  assert.equal(r.resize, undefined)
  await r.prepare([]); assert.equal(f.disposals, 1); assert.equal(f.images[0].image.closed, 1)
  r.dispose(); r.dispose(); assert.equal(f.images[0].image.closed, 1)
})
test("failed validation, decode and dimensions preserve old prepared fonts", async () => {
  for (const failure of ["schema", "missing", "json", "read", "decode", "dimensions"]) {
    const f = fixture(), r = f.renderer, a = obj(); await r.prepare([a])
    f.documents["new.json"] = doc()
    if (failure === "schema") f.documents["new.json"].version = 2
    if (failure === "dimensions") f.width = 15
    if (failure === "decode") f.decode = () => { throw new Error("decode failed") }
    f.read = (op, path) => {
      if (path === "new.json" && failure === "json") return "{"
      if (op.endsWith("read-file") && failure === "read") throw new Error("read failed")
    }
    await assert.rejects(r.prepare([obj({ font: "new.json", text: failure === "missing" ? "B" : "AV" })]))
    assert.deepEqual(r.bounds(a), model.layoutWorldText(doc(), "AV", 20).bounds)
    assert.equal(f.images[0].image.closed, 0)
    assert(f.images.slice(1).every(v => v.image.closed === 1))
    assert.throws(() => r.bounds(obj({ font: "new.json" })), /not prepared/)
    r.dispose()
  }
})
test("dispose and newer preparation invalidate pending loads", async () => {
  for (const newer of [false, true]) {
    const f = fixture(), r = f.renderer
    let release, start
    const started = new Promise(resolve => start = resolve)
    f.decode = () => { start(); return new Promise(resolve => release = resolve) }
    const pending = r.prepare([obj()]); await started
    if (newer) await r.prepare([]); else r.dispose()
    release(); await assert.rejects(pending, /superseded/)
    assert.equal(f.images[0].image.closed, 1)
  }
})
test("invalid object data and configs fail explicitly", async () => {
  const f = fixture()
  for (const config of [null, [], { origin: null }, { origin: {} }, { origin: [1] }, { origin: [2, 0] }, { origin: [NaN, 0] }])
    assert.throws(() => f.createWorldObjectRenderer({ config }))
  for (const patch of [{ font: "" }, { text: null }, { fontSize: "" }, { fontSize: true }, { fontSize: 0 }, { fontSize: Infinity }, { color: "red" }, { color: "#fff" }])
    await assert.rejects(f.renderer.prepare([obj(patch)]))
  await f.renderer.prepare([obj({ fontSize: "20" })])
  assert.throws(() => f.renderer.draw({}, obj(), { scale: 1 }), /2d context/)
  assert.throws(() => f.renderer.draw(new Context(), obj(), { scale: 0 }), /frame.scale/)
  const origin = [0.5, 1], r = f.createWorldObjectRenderer({ config: { origin } }); origin[0] = 0
  await r.prepare([obj()]); assert.deepEqual(r.bounds(obj()), { minX: -12, minY: -26, maxX: 12, maxY: 0 })
  r.dispose(); f.renderer.dispose()
})
