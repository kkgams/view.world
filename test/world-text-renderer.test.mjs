import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
const modelSource = await readFile(new URL("../src/text-model.js", import.meta.url), "utf8")
const model = await import(`data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}`)
const source = await readFile(new URL("../src/world-renderers/text.js", import.meta.url), "utf8")
const doc = () => ({
  atlas: { width: 16, height: 16, size: 32, distanceRange: 4, distanceRangeMiddle: 0, type: "mtsdf", yOrigin: "bottom" },
  metrics: { emSize: 1, lineHeight: 1.2, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    { unicode: 65, advance: 0.6, planeBounds: { left: -0.1, right: 0.6, bottom: -0.2, top: 0.9 }, atlasBounds: { left: 0, right: 7, bottom: 0, top: 11 } },
    { unicode: 86, advance: 0.6, planeBounds: { left: 0, right: 0.6, bottom: 0, top: 0.8 }, atlasBounds: { left: 8, right: 14, bottom: 0, top: 8 } },
    { unicode: 0x1f600, advance: 1 },
  ], kerning: [{ unicode1: 65, unicode2: 86, advance: -0.1 }],
})
const obj = (patch = {}) => ({ props: { render: "text", font: "fonts/test.arfont", text: "AV", fontSize: 20, color: "#ff800080", ...patch } })
class Context {}
function fixture() {
  const f = { reads: [], releases: [], draws: [], disposals: 0, document: doc(), pixels: Array(16 * 16 * 4).fill(127),
    info: { dimensions: { width: 16, height: 16 }, "pixel-format": "rgba8", "atlas-type": "mtsdf", size: 32, "distance-range": 4 }, resource: { $resource: "font", id: "1" } }
  const runtime = {
    async invoke(op, arg) {
      f.reads.push([op, arg])
      if (f.read) { const result = await f.read(op, arg); if (result !== undefined) return result }
      if (op === "fs/fs::read-file") return { ok: [1, 2] }
      if (op === "font/font::decode") return { ok: f.resource }
      if (op === "font/font::atlas-info") return f.info
      if (op === "font/font::atlas-pixels") return f.pixels
      if (op === "font/font::metadata-json") return JSON.stringify(f.document)
      throw new Error(`Unexpected operation ${op}`)
    },
    async releaseResource(resource) { f.releases.push(resource) },
  }
  const exports = new Function("runtime", "unwrap", ...Object.keys(model), "createTextRaster", "CanvasRenderingContext2D",
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") + "\nreturn { createWorldObjectRenderer, readFont }")(
    runtime, result => { if (Object.hasOwn(result, "ok")) return result.ok; throw new Error(String(result.err)) },
    ...Object.values(model), () => ({ draw(...args) { f.draws.push(args) }, dispose() { f.disposals++ } }), Context)
  Object.assign(f, exports)
  f.renderer = exports.createWorldObjectRenderer({ config: {} })
  return f
}

test("font model validates raw metadata, .arfont paths, bounds, scalars and pairs", () => {
  assert.deepEqual(model.validateFontDocument(doc()), doc())
  const mutations = [
    d => d.atlas.yOrigin = "top", d => d.atlas.distanceRangeMiddle = 1, d => d.atlas.width = 0,
    d => d.atlas.distanceRange = Infinity, d => d.metrics.emSize = 0, d => d.metrics.lineHeight = -1,
    d => d.metrics.ascender = -1, d => d.glyphs.push(d.glyphs[0]), d => d.glyphs[0].unicode = 0xd800,
    d => d.glyphs[0].advance = -1, d => delete d.glyphs[1].atlasBounds,
    d => d.glyphs[1].planeBounds.top = -0.2, d => d.glyphs[1].atlasBounds.right = 17,
    d => d.kerning.push(d.kerning[0]), d => d.kerning[0].unicode1 = 100, d => d.kerning[0].advance = NaN,
  ]
  for (const mutate of mutations) { const d = doc(); mutate(d); assert.throws(() => model.validateFontDocument(d)) }
  for (const path of [null, "", "/a", "a/", "a//b", "./a", "a/../b", "a\\b", "http:a", "a\u0000.arfont", "font.json", "font.png", "font.arfont.png"])
    assert.throws(() => model.fontProjectPath(path), /Project-relative|arfont/)
})
test("kerning, negative bearings, multiline, spaces, Unicode and bottom-up UV coordinates", () => {
  const d = doc(), l = model.layoutWorldText(d, "AV", 20)
  assert.deepEqual(l.bounds, { minX: 0, minY: 0, maxX: 24, maxY: 26 })
  assert.deepEqual(l.quads[0], { x: 0, y: 0, width: 14, height: 22, uv: [0, 11/16, 7/16, -11/16] })
  assert.deepEqual(l.quads[1], { x: 12, y: 2, width: 12, height: 16, uv: [0.5, 0.5, 6/16, -0.5] })
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
test("readFont unwraps only decode and reads plain atlas values before releasing the resource", async () => {
  const f = fixture(), font = await f.readFont("fonts/test.arfont")
  assert.deepEqual(font, { document: doc(), pixels: new Uint8Array(f.pixels), channels: 4 })
  assert.deepEqual(f.reads.map(([op]) => op), ["fs/fs::read-file", "font/font::decode", "font/font::atlas-info", "font/font::atlas-pixels", "font/font::metadata-json"])
  assert.deepEqual(f.reads[0][1], "fonts/test.arfont")
  assert.deepEqual(f.reads[1][1], [1, 2])
  for (const [, arg] of f.reads.slice(2)) assert.equal(arg, f.resource)
  assert.deepEqual(f.releases, [f.resource])
})
test("readFont preserves each supported channel format", async () => {
  for (const [type, format, channels] of [["sdf", "r8", 1], ["psdf", "r8", 1], ["msdf", "rgb8", 3], ["mtsdf", "rgba8", 4]]) {
    const f = fixture(); f.document.atlas.type = type; f.info["atlas-type"] = type; f.info["pixel-format"] = format
    f.pixels = Array(16 * 16 * channels).fill(23)
    const font = await f.readFont("fonts/test.arfont")
    assert.equal(font.channels, channels); assert.deepEqual(font.pixels, new Uint8Array(f.pixels))
    assert.deepEqual(f.releases, [f.resource])
  }
})
test("readFont surfaces decode code/message and releases only acquired resources", async () => {
  for (const operation of ["fs/fs::read-file", "font/font::decode"]) {
    const f = fixture()
    f.read = op => op !== operation ? undefined : operation.endsWith("decode") ? { err: { code: "invalid-artery", message: "bad header" } } : Promise.reject(new Error("read failed"))
    await assert.rejects(f.readFont("fonts/test.arfont"), operation.endsWith("decode") ? /invalid-artery.*bad header/ : /read failed/)
    assert.deepEqual(f.releases, [])
  }
  const f = fixture(); await assert.rejects(f.readFont("fonts/test.json")); assert.deepEqual(f.reads, [])
})
test("malformed decode results and invalid file bytes fail before atlas access", async () => {
  for (const result of [null, {}, { ok: null }, { ok: { id: 1 } }, { err: "bad" }, { err: { code: "invalid-artery" } }, { ok: {}, err: {} }]) {
    const f = fixture(); f.read = op => op.endsWith("decode") ? result : undefined
    await assert.rejects(f.readFont("fonts/test.arfont"))
    assert.equal(f.reads.length, 2); assert.deepEqual(f.releases, [])
  }
  for (const bytes of [[256], [-1], [0.5], "bytes", new Uint8Array([1])]) {
    const f = fixture(); f.read = op => op.endsWith("read-file") ? { ok: bytes } : undefined
    await assert.rejects(f.readFont("fonts/test.arfont"), /bytes/)
    assert.equal(f.reads.length, 1); assert.deepEqual(f.releases, [])
  }
})
test("all post-decode failures release resources", async () => {
  const mutations = [
    f => f.info.dimensions.width = 15, f => f.info.dimensions.height = 15,
    f => f.info["atlas-type"] = "msdf", f => f.info.size = 33, f => f.info["distance-range"] = 5,
    f => f.info["pixel-format"] = "rgb8", f => f.info["pixel-format"] = "unknown",
    f => f.pixels.pop(), f => f.pixels.push(0), f => f.document.atlas.width = 0,
    ...[-1, 256, 0.5, NaN].map(value => f => f.pixels[0] = value),
    f => f.pixels = new Uint8Array(f.pixels),
    f => f.info = { ok: f.info }, f => f.pixels = { ok: f.pixels },
    f => f.read = op => op.endsWith("metadata-json") ? { ok: JSON.stringify(doc()) } : undefined,
    f => f.read = op => op.endsWith("metadata-json") ? "{" : undefined,
    ...["atlas-info", "atlas-pixels", "metadata-json"].map(name => f => f.read = op => { if (op.endsWith(name)) throw new Error("backend failed") }),
  ]
  for (const mutate of mutations) {
    const f = fixture(); mutate(f)
    await assert.rejects(f.readFont("fonts/test.arfont"))
    assert.deepEqual(f.releases, [f.resource])
  }
})
test("prepares referenced font objects once, draws raw pixels and evicts naturally", async () => {
  const f = fixture(), r = f.renderer, a = obj()
  assert.throws(() => r.bounds(a), /not prepared/)
  await r.prepare([a, a]); await r.prepare([a])
  assert.equal(f.reads.length, 5); assert.deepEqual(f.releases, [f.resource])
  const ctx = new Context(); r.draw(ctx, a, { scale: 2 })
  const [actualContext, layout, font, color] = f.draws[0]
  assert.equal(actualContext, ctx); assert.deepEqual(layout.bounds, r.bounds(a))
  assert.deepEqual(font.pixels, new Uint8Array(f.pixels)); assert.equal(font.channels, 4)
  r.draw(ctx, a, { scale: 2 }); assert.equal(f.draws[1][2], font)
  assert.deepEqual(color, [1, 128/255, 0, 128/255])
  r.draw(ctx, obj({ text: " " }), { scale: 1 }); assert.equal(f.draws.length, 2)
  assert.equal(r.resize, undefined)
  await r.prepare([]); assert.equal(f.disposals, 1)
  assert.throws(() => r.bounds(a), /not prepared/)
  await r.prepare([a]); assert.equal(f.reads.length, 10)
  r.dispose(); r.dispose(); assert.deepEqual(f.releases, [f.resource, f.resource])
})
test("failed font validation and missing glyphs preserve old prepared fonts", async () => {
  for (const failure of ["schema", "missing", "json", "read", "decode", "dimensions"]) {
    const f = fixture(), r = f.renderer, a = obj(); await r.prepare([a])
    if (failure === "schema") f.document.atlas.width = 0
    if (failure === "dimensions") f.info.dimensions.width = 15
    f.read = op => {
      if (op.endsWith("metadata-json") && failure === "json") return "{"
      if (op.endsWith("read-file") && failure === "read") throw new Error("read failed")
      if (op.endsWith("decode") && failure === "decode") return { err: { code: "invalid-artery", message: "decode failed" } }
    }
    await assert.rejects(r.prepare([obj({ font: "new.arfont", text: failure === "missing" ? "B" : "AV" })]))
    assert.deepEqual(r.bounds(a), model.layoutWorldText(doc(), "AV", 20).bounds)
    assert.throws(() => r.bounds(obj({ font: "new.arfont" })), /not prepared/)
    assert.equal(f.releases.length, ["read", "decode"].includes(failure) ? 1 : 2)
    r.dispose()
  }
})
test("dispose and newer preparation invalidate pending resource loads", async () => {
  for (const newer of [false, true]) {
    const f = fixture(), r = f.renderer
    let release, start
    const started = new Promise(resolve => start = resolve)
    f.read = op => { if (op.endsWith("atlas-pixels")) { start(); return new Promise(resolve => release = () => resolve(f.pixels)) } }
    const pending = r.prepare([obj()]); await started
    if (newer) await r.prepare([]); else r.dispose()
    release(); await assert.rejects(pending, /superseded/)
    assert.deepEqual(f.releases, [f.resource])
    assert.throws(() => r.bounds(obj()), /not prepared/)
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

test("included example is an Artery font container", async () => {
  const bytes = await readFile(new URL("../examples/world-example.arfont", import.meta.url))
  assert.equal(bytes.subarray(0, 16).toString("ascii"), "ARTERY/FONT\0\0\0\0\0")
  assert(bytes.length > 128)
})
