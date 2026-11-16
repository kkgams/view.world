import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../src/world-renderers/nine.js", import.meta.url), "utf8")
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
  format: "gams.nine", version: 1, image: "atlas.png",
  slices: [
    { name: "panel <safe>", type: "nine", bounds: { x: 0, y: 0, width: 12, height: 10 }, center: { x: 2, y: 3, width: 6, height: 2 } },
    { name: "bar", type: "horizontal", bounds: { x: 12, y: 0, width: 20, height: 4 }, center: { x: 3, y: 0, width: 10, height: 4 } },
    { name: "column", type: "vertical", bounds: { x: 0, y: 10, width: 5, height: 20 }, center: { x: 0, y: 3, width: 5, height: 10 } },
    { name: "icon", type: "region", bounds: { x: 5, y: 10, width: 8, height: 7 } },
  ],
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture() {
  const calls = [], reads = [], adds = []
  const f = { choice: { selection: [{ path: "panels/ui.json" }] }, data, calls, reads, adds }
  const runtime = {
    async call(name, args) { calls.push([name, args]); return { ok: name === "ui.popup.open" ? await f.choice : undefined } },
    async invoke(name, path) { reads.push([name, path]); const result = await f.data; return { ok: typeof result === "string" ? result : JSON.stringify(result) } },
  }
  const body = source.replace(/^import .*$/gm, "").replace(/^export /gm, "")
  const { createWorldObjectRenderer } = new Function("runtime", "unwrap", "document", `${body}\nreturn { createWorldObjectRenderer }`)(runtime, result => result.ok, { createElement: tag => new Element(tag) })
  f.renderer = createWorldObjectRenderer({ config: {} })
  f.panel = f.renderer.createSidebarPanel({ async addObject(props) { adds.push(props); await f.addResult } })
  f.root = f.panel.element
  for (const [name, attribute, value] of [["importButton", "data-action", "import-nine"], ["form", "data-element", "nine-form"], ["path", "data-element", "nine-path"], ["select", "data-field", "nine-slice"], ["width", "data-field", "nine-width"], ["height", "data-field", "nine-height"], ["add", "data-action", "add-nine"]]) f[name] = f.root.find(attribute, value)
  f.import = () => f.importButton.emit("click")
  f.submit = () => f.form.emit("submit")
  f.toasts = () => calls.filter(([name]) => name.startsWith("ui.toast"))
  return f
}
const snapshot = f => JSON.stringify([f.path.textContent, f.select.value, f.select.children.map(o => [o.value, o.textContent]), f.width.value, f.height.value, f.width.min, f.height.min, f.importButton.disabled, f.add.disabled])
const tick = () => new Promise(resolve => setImmediate(resolve))

test("panel starts source-disabled and requires injected callback", () => {
  const f = fixture()
  assert.throws(() => f.renderer.createSidebarPanel({}), /requires addObject/)
  assert.equal(f.root.tagName, "FIELDSET")
  assert.equal(f.root.children[0].tagName, "LEGEND")
  assert.equal(f.root.children[0].textContent, "Nine slice")
  assert.equal(f.importButton.disabled, false)
  for (const control of [f.select, f.width, f.height, f.add]) assert.equal(control.disabled, true)
})
test("no-source submit does not create; chooser errors recover controls", async () => {
  const f = fixture()
  assert.equal((await f.submit()).prevented, true)
  assert.equal(f.adds.length, 0)
  f.choice = Promise.reject(new Error("chooser failed")); await f.import()
  assert.deepEqual(f.toasts(), [["ui.toast.error", { message: "chooser failed" }]])
  assert.equal(f.importButton.disabled, false)
  assert.equal(f.add.disabled, true)
})
test("chooser/local reader, safe names, dimensions/minima and exact injected object props", async () => {
  const f = fixture(); await f.import()
  assert.deepEqual(f.calls[0], ["ui.popup.open", { title: "Import Nine-slice JSON", size: "medium", tag: "view-files", props: { mode: "chooser", filter: "*.json" } }])
  assert.deepEqual(f.reads, [["fs/fs::read-text", "panels/ui.json"]])
  assert.equal(f.path.textContent, "panels/ui.json")
  assert.deepEqual(f.select.children.map(o => o.textContent), ["panel <safe>", "bar", "column", "icon"])
  assert.deepEqual([f.width.value, f.height.value, f.width.min, f.height.min], ["12", "10", "6", "8"])
  f.select.value = "bar"; await f.select.emit("change")
  assert.deepEqual([f.width.value, f.height.value, f.width.min, f.height.min], ["20", "4", "10", "4"])
  f.width.value = "35"
  assert.equal((await f.submit()).prevented, true)
  assert.deepEqual(f.adds, [{ nine: "panels/ui.json", slice: "bar", width: 35, height: 4 }])
  assert.deepEqual(f.toasts().map(([name]) => name), ["ui.toast.success", "ui.toast.success"])
})
test("fixed-axis fields, attributes and source defaults follow slice changes", async () => {
  const f = fixture(); await f.import()
  for (const [name, w, h, minW, minH, maxW, maxH] of [
    ["bar", 20, 4, 10, 4, undefined, 4],
    ["column", 5, 20, 5, 10, 5, undefined],
    ["icon", 8, 7, 8, 7, 8, 7],
    ["panel <safe>", 12, 10, 6, 8, undefined, undefined],
  ]) {
    f.select.value = name; await f.select.emit("change")
    assert.deepEqual([f.width.value, f.height.value], [String(w), String(h)])
    for (const [control, min, max] of [[f.width, minW, maxW], [f.height, minH, maxH]]) {
      assert.equal(control.attributes.min, String(min))
      assert.equal(control.attributes.max, max === undefined ? undefined : String(max))
      assert.equal(control.disabled, max !== undefined)
    }
    await f.submit()
    assert.equal(f.adds.at(-1).slice, name)
    assert.deepEqual([f.width.disabled, f.height.disabled], [maxW !== undefined, maxH !== undefined])
  }
})
for (const name of ["bar", "column", "icon"]) {
  test(`${name} fixed dimensions reject tampering and survive import/busy transitions`, async () => {
    const f = fixture(); f.data = { ...data, slices: data.slices.filter(s => s.name === name) }; await f.import()
    const fixed = name === "bar" ? [f.height] : name === "column" ? [f.width] : [f.width, f.height]
    for (const control of fixed) {
      assert.equal(control.disabled, true)
      const original = control.value
      for (const delta of [-1, 1]) {
        control.value = String(Number(original) + delta); await f.submit()
        assert.equal(f.adds.length, 0)
        assert.match(f.toasts().at(-1)[1].message, /minimum|maximum|fixed/)
        assert.equal(control.disabled, true)
      }
      control.value = original
    }
    const pending = deferred(); f.addResult = pending.promise
    const adding = f.submit(); await tick()
    assert.equal(f.width.disabled, true); assert.equal(f.height.disabled, true)
    pending.resolve(); await adding
    assert.deepEqual([f.width.disabled, f.height.disabled], [name !== "bar", name !== "column"])
    f.choice = { cancelled: true }; await f.import()
    assert.deepEqual([f.width.disabled, f.height.disabled], [name !== "bar", name !== "column"])
  })
}
test("cancel and import errors preserve prior source and dimensions", async () => {
  const f = fixture(); await f.import(); f.width.value = "37"
  const before = snapshot(f)
  for (const choice of [null, { cancelled: true }]) { f.choice = choice; await f.import(); assert.equal(snapshot(f), before) }
  for (const result of ["{", { ...data, version: 2 }, { ...data, slices: [] }]) {
    f.choice = { selection: { path: "other.json" } }; f.data = result; await f.import()
    assert.equal(snapshot(f), before); assert.equal(f.toasts().at(-1)[0], "ui.toast.error")
  }
  f.data = Promise.reject(new Error("read failure")); await f.import(); assert.equal(snapshot(f), before)
  f.choice = {}; await f.import(); assert.match(f.toasts().at(-1)[1].message, /selected path/)
  await f.submit(); assert.equal(f.adds[0].nine, "panels/ui.json")
})
test("positive integer/minimum validation, missing selection, and add errors toast", async () => {
  const f = fixture(); await f.import()
  for (const [width, height, message] of [["", "10", /width/], ["2.5", "10", /integer/], ["12", "0", /height/], ["12", "Infinity", /height/], ["5", "10", /minimum/], ["12", "7", /minimum/]]) {
    f.width.value = width; f.height.value = height; await f.submit()
    assert.match(f.toasts().at(-1)[1].message, message); assert.equal(f.adds.length, 0)
  }
  f.width.value = "12"; f.height.value = "10"; f.select.value = "missing"; await f.submit()
  assert.match(f.toasts().at(-1)[1].message, /missing imported slice/)
  f.select.value = "panel <safe>"; f.addResult = Promise.reject(new Error("create failed")); await f.submit()
  assert.deepEqual(f.toasts().at(-1), ["ui.toast.error", { message: "create failed" }]); assert.equal(f.add.disabled, false)
})
test("pending chooser/read/add serialize gestures; World root disabled is independently owned", async () => {
  const f = fixture(), chooser = deferred(), read = deferred()
  f.choice = chooser.promise; f.data = read.promise
  const loading = f.import(); await tick()
  assert.equal(f.importButton.disabled, true); await f.import(); await f.submit(); assert.equal(f.calls.length, 1)
  chooser.resolve({ selection: { path: "ui.json" } }); await tick(); await f.import(); assert.equal(f.reads.length, 1)
  read.resolve(data); await loading
  const add = deferred(); f.addResult = add.promise
  const creating = f.submit(); await tick(); await f.submit(); await f.import()
  assert.equal(f.adds.length, 1); assert.equal(f.calls.filter(([n]) => n === "ui.popup.open").length, 1)
  f.root.disabled = true; add.resolve(); await creating
  assert.equal(f.root.disabled, true); assert.equal(f.importButton.disabled, false)
  await f.import(); await f.submit(); assert.equal(f.adds.length, 1)
  f.root.disabled = false; await f.submit(); assert.equal(f.adds.length, 2)
})
for (const stage of ["chooser", "read", "create"]) {
  for (const reject of [false, true]) {
    test(`disposal during ${stage} ${reject ? "rejection" : "resolution"} prevents late effects`, async () => {
      const f = fixture(), pending = deferred()
      if (stage === "create") await f.import()
      if (stage === "chooser") f.choice = pending.promise
      if (stage === "read") f.data = pending.promise
      if (stage === "create") f.addResult = pending.promise
      const action = stage === "create" ? f.submit() : f.import()
      await tick(); f.panel.dispose(); f.panel.dispose()
      const before = snapshot(f), toastCount = f.toasts().length, addCount = f.adds.length, readCount = f.reads.length
      if (reject) pending.reject(new Error("late failure"))
      else pending.resolve(stage === "chooser" ? { selection: { path: "late.json" } } : data)
      await action
      assert.equal(snapshot(f), before); assert.equal(f.toasts().length, toastCount); assert.equal(f.adds.length, addCount); assert.equal(f.reads.length, readCount)
      assert.equal(f.importButton.listeners.size + f.select.listeners.size + f.form.listeners.size, 0)
      await f.import(); await f.submit(); await f.select.emit("change")
      assert.equal(snapshot(f), before); assert.equal(f.adds.length, addCount)
    })
  }
}
