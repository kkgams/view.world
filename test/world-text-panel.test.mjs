import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const model = await import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL("../src/text-model.js", import.meta.url))).toString("base64")}`)
const source = await readFile(new URL("../src/world-renderers/text.js", import.meta.url), "utf8")
// Adapt only the panel's DOM operations and Host boundary; run the real module.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.disabled = false; this.value = ""; this.textContent = "" }
  setAttribute(name, value) { this.attributes[name] = value; if (["value", "min", "max"].includes(name)) this[name] = value }
  removeAttribute(name) { delete this.attributes[name]; if (["min", "max"].includes(name)) this[name] = "" }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(type, listener) { this.listeners.set(type, listener) }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type) }
  async emit(type) { const event = { prevented: false, preventDefault() { this.prevented = true } }; await this.listeners.get(type)?.(event); return event }
  find(name, value) { if (this.attributes[name] === value) return this; for (const child of this.children) { const result = child.find(name, value); if (result) return result } }
}
const data = {
  format: "gams.font", version: 1, image: "atlases/font.png",
  atlas: { type: "msdf", width: 16, height: 16, size: 24, distanceRange: 4, distanceRangeMiddle: 0, yOrigin: "bottom" },
  metrics: { emSize: 1, ascender: 0.8, descender: -0.2, lineHeight: 1.2 },
  glyphs: [{ unicode: 65, advance: 0.6, planeBounds: { left: 0, right: 0.6, bottom: 0, top: 0.8 }, atlasBounds: { left: 0, right: 6, bottom: 0, top: 8 } }], kerning: [],
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture() {
  const calls = [], reads = [], adds = [], decodes = []
  const f = { choice: { selection: [{ path: "fonts/ui.json" }] }, data, bytes: [137, 80, 78, 71], calls, reads, adds, decodes }
  f.image = { width: 16, height: 16, closes: 0, close() { this.closes++ } }
  const runtime = {
    async call(name, args) { calls.push([name, args]); return { ok: name === "ui.popup.open" ? await f.choice : undefined } },
    async invoke(name, path) { reads.push([name, path]); const result = await (name === "fs/fs::read-text" ? f.data : f.bytes); return { ok: name === "fs/fs::read-text" && typeof result !== "string" ? JSON.stringify(result) : result } },
  }
  const body = source.replace(/^import .*$/gm, "").replace(/^export /gm, "")
  const names = ["runtime", "unwrap", "document", "createImageBitmap", "createTextRaster", ...Object.keys(model)]
  const values = [runtime, result => result.ok, { createElement: tag => new Element(tag) }, async (...args) => { decodes.push(args); return await (f.bitmap ?? f.image) }, () => { throw new Error("Sidebar must not create a text raster") }, ...Object.values(model)]
  const create = new Function(...names, `${body}\nreturn createWorldObjectRenderer`)(...values)
  f.renderer = create({ config: {} })
  f.panel = f.renderer.createSidebarPanel({ async addObject(props) { adds.push(props); await f.addResult } })
  f.root = f.panel.element
  for (const [name, attribute, value] of [["importButton", "data-action", "import-font"], ["form", "data-element", "text-form"], ["path", "data-element", "font-path"], ["text", "data-field", "text"], ["size", "data-field", "fontSize"], ["color", "data-field", "color"], ["add", "data-action", "add-text"]]) f[name] = f.root.find(attribute, value)
  f.import = () => f.importButton.emit("click")
  f.submit = () => f.form.emit("submit")
  f.toasts = () => calls.filter(([name]) => name.startsWith("ui.toast"))
  return f
}
const snapshot = f => JSON.stringify([f.path.textContent, f.text.value, f.size.value, f.color.value, f.root.disabled, ...[f.importButton, f.text, f.size, f.color, f.add].map(el => el.disabled)])
const tick = () => new Promise(resolve => setImmediate(resolve))

test("text panel starts source-disabled and requires injected addObject", async () => {
  const f = fixture()
  assert.throws(() => f.renderer.createSidebarPanel({}), /requires addObject/)
  assert.equal(f.root.tagName, "FIELDSET")
  assert.equal(f.root.children[0].tagName, "LEGEND")
  assert.equal(f.root.children[0].textContent, "Text")
  assert.equal(f.importButton.disabled, false)
  for (const control of [f.text, f.size, f.color, f.add]) assert.equal(control.disabled, true)
  assert.deepEqual([f.text.value, f.size.value, f.color.value], ["Text", "24", "#ffffff"])
  assert.equal((await f.submit()).prevented, true)
  assert.deepEqual(f.adds, []); assert.deepEqual(f.calls, [])
})
test("chooser validates/closes linked image before enabling exact add props", async () => {
  const f = fixture(), pending = deferred(); f.bitmap = pending.promise
  const importing = f.import(); await tick()
  assert.deepEqual(f.calls[0], ["ui.popup.open", { title: "Import Font JSON", size: "medium", tag: "view-files", props: { mode: "chooser", filter: "*.json" } }])
  assert.deepEqual(f.reads, [["fs/fs::read-text", "fonts/ui.json"], ["fs/fs::read-file", "atlases/font.png"]])
  assert.equal(f.path.textContent, "No font imported"); assert.equal(f.add.disabled, true)
  const [blob, options] = f.decodes[0]
  assert.equal(blob.type, "image/png")
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], f.bytes)
  assert.deepEqual(options, { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none" })
  pending.resolve(f.image); await importing
  assert.equal(f.image.closes, 1); assert.equal(f.path.textContent, "fonts/ui.json")
  for (const control of [f.text, f.size, f.color, f.add]) assert.equal(control.disabled, false)
  f.text.value = "A\nAA"; f.size.value = "12.5"; f.color.value = "#Ab12EF80"
  assert.equal((await f.submit()).prevented, true)
  assert.deepEqual(f.adds, [{ font: "fonts/ui.json", text: "A\nAA", fontSize: 12.5, color: "#Ab12EF80" }])
  assert.equal(f.image.closes, 1)
})
test("invalid size/color and missing glyph fail before add; add errors recover", async () => {
  const f = fixture(); await f.import(); f.text.value = "A"
  for (const value of ["", "0", "-1", "Infinity", "NaN"]) {
    f.size.value = value; await f.submit(); assert.match(f.toasts().at(-1)[1].message, /positive fontSize/)
  }
  f.size.value = "24"
  for (const value of ["red", "#fff", "#ffffffgg"]) {
    f.color.value = value; await f.submit(); assert.match(f.toasts().at(-1)[1].message, /color/)
  }
  f.color.value = "#ffffff"; f.text.value = "B"; await f.submit()
  assert.match(f.toasts().at(-1)[1].message, /missing glyph U\+0042/)
  assert.deepEqual(f.adds, [])
  f.text.value = "A"; f.addResult = Promise.reject(new Error("create failed")); await f.submit()
  assert.deepEqual(f.toasts().at(-1), ["ui.toast.error", { message: "create failed" }])
  assert.equal(f.add.disabled, false)
})
test("cancelled and failed imports preserve prior source and authored fields", async () => {
  const f = fixture(); await f.import(); f.text.value = "AA"; f.size.value = "17"; f.color.value = "#112233"
  const before = snapshot(f), toastCount = f.toasts().length
  for (const choice of [null, { cancelled: true }]) { f.choice = choice; await f.import(); assert.equal(snapshot(f), before) }
  assert.equal(f.toasts().length, toastCount)
  for (const [field, makeValue, message] of [
    ["choice", () => ({}), /selected path/],
    ["choice", () => Promise.reject(new Error("chooser failed")), /chooser failed/],
    ["data", () => "{", /JSON|property name/],
    ["data", () => ({ ...data, version: 2 }), /version 1/],
    ["data", () => ({ ...data, image: "../outside.png" }), /Project-relative/],
    ["data", () => Promise.reject(new Error("read failed")), /read failed/],
    ["bytes", () => Promise.reject(new Error("atlas read failed")), /atlas read failed/],
    ["bitmap", () => Promise.reject(new Error("decode failed")), /decode failed/],
    ["bitmap", () => ({ width: 15, height: 16, closes: 0, close() { this.closes++ } }), /dimensions disagree/],
  ]) {
    f.choice = { selection: { path: "other.json" } }; f.data = data; f.bytes = [137]; f.bitmap = undefined
    const value = makeValue(); f[field] = value; await f.import()
    assert.equal(snapshot(f), before); assert.match(f.toasts().at(-1)[1].message, message)
    if (field === "bitmap" && !(value instanceof Promise)) assert.equal(value.closes, 1)
  }
  await f.submit()
  assert.deepEqual(f.adds, [{ font: "fonts/ui.json", text: "AA", fontSize: 17, color: "#112233" }])
})
test("pending chooser/read/decode/add serialize gestures; disabled root blocks new work", async () => {
  const f = fixture(), chooser = deferred(), read = deferred(), decode = deferred()
  f.choice = chooser.promise; f.data = read.promise; f.bitmap = decode.promise
  const importing = f.import(); await tick()
  await f.import(); await f.submit(); assert.equal(f.calls.length, 1)
  chooser.resolve({ selection: { path: "fonts/ui.json" } }); await tick()
  await f.import(); assert.equal(f.reads.length, 1)
  read.resolve(data); await tick()
  await f.import(); await f.submit(); assert.equal(f.decodes.length, 1); assert.equal(f.adds.length, 0)
  decode.resolve(f.image); await importing
  const add = deferred(); f.addResult = add.promise; f.text.value = "A"
  const adding = f.submit(); await tick()
  for (const control of [f.importButton, f.text, f.size, f.color, f.add]) assert.equal(control.disabled, true)
  await f.submit(); await f.import(); assert.equal(f.adds.length, 1)
  f.root.disabled = true; add.resolve(); await adding
  assert.equal(f.root.disabled, true)
  const before = snapshot(f), calls = f.calls.length
  await f.import(); await f.submit()
  assert.equal(snapshot(f), before); assert.equal(f.calls.length, calls); assert.equal(f.adds.length, 1)
  f.root.disabled = false; await f.submit(); assert.equal(f.adds.length, 2)
})
for (const stage of ["chooser", "read", "image", "decode", "add"]) {
  for (const reject of [false, true]) {
    test(`disposal during ${stage} ${reject ? "rejection" : "resolution"} prevents late DOM/add/toast effects`, async () => {
      const f = fixture(), pending = deferred()
      if (stage === "add") { await f.import(); f.text.value = "A" }
      f[{ chooser: "choice", read: "data", image: "bytes", decode: "bitmap", add: "addResult" }[stage]] = pending.promise
      const action = stage === "add" ? f.submit() : f.import()
      await tick(); f.panel.dispose(); f.panel.dispose()
      const before = snapshot(f), toasts = f.toasts().length, adds = f.adds.length
      if (reject) pending.reject(new Error("late failure"))
      else pending.resolve({ chooser: { selection: { path: "late.json" } }, read: data, image: [137], decode: f.image, add: undefined }[stage])
      await action
      assert.equal(snapshot(f), before); assert.equal(f.toasts().length, toasts); assert.equal(f.adds.length, adds)
      if (stage === "chooser") assert.equal(f.reads.length, 0)
      if (stage === "read") assert.equal(f.decodes.length, 0)
      if (!reject && ["image", "decode"].includes(stage)) assert.equal(f.image.closes, 1)
      assert.equal(f.importButton.listeners.size + f.form.listeners.size, 0)
      const calls = f.calls.length, reads = f.reads.length
      await f.import(); await f.submit()
      assert.equal(snapshot(f), before); assert.equal(f.calls.length, calls); assert.equal(f.reads.length, reads)
    })
  }
}
