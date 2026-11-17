import { runtime, unwrap } from "/core/runtime.js"
import { fontProjectPath, validateFontDocument, textObjectData, layoutWorldText } from "../text-model.js"
import { createTextRaster } from "../text-raster.js"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export async function readFontDocument(path) {
  fontProjectPath(path)
  return validateFontDocument(JSON.parse(unwrap(await runtime.invoke("fs/fs::read-text", path))))
}

async function loadFontImage(doc) {
  const bytes = new Uint8Array(unwrap(await runtime.invoke("fs/fs::read-file", doc.image)))
  const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none",
  })
  try {
    assert(image.width === doc.atlas.width && image.height === doc.atlas.height,
      `Font atlas dimensions disagree with metadata: ${doc.image}`)
    return image
  } catch (error) {
    image.close()
    throw error
  }
}

export function createWorldObjectRenderer({ config }) {
  assert(config && typeof config === "object" && !Array.isArray(config), "text renderer config must be an object")
  const value = config.origin === undefined ? [0, 0] : config.origin
  assert(Array.isArray(value) && value.length === 2 &&
    Array.from(value).every(v => Number.isFinite(v) && v >= 0 && v <= 1), "text renderer origin must be [x,y] between 0 and 1")
  const origin = [...value]
  let fonts = new Map(), generation = 0, raster = null

  function prepared(object) {
    const data = textObjectData(object)
    const font = fonts.get(data.path)
    assert(font, `Font not prepared: ${data.path}`)
    return { data, font, layout: layoutWorldText(font.document, data.text, data.size, origin) }
  }

  return {
    createSidebarPanel({ addObject }) {
      assert(typeof addObject === "function", "text panel requires addObject()")
      const node = (tag, attributes = {}, text) => {
        const el = document.createElement(tag)
        for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value)
        if (text !== undefined) el.textContent = text
        return el
      }
      const exact = { autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false" }
      const element = node("fieldset", { "data-element": "text-renderer" })
      const choose = node("button", { type: "button", "data-action": "import-font" }, "Import font JSON")
      const path = node("output", { "data-element": "font-path" }, "No font imported")
      const form = node("form", { "data-element": "text-form" })
      const text = node("textarea", { ...exact, "data-field": "text" })
      const size = node("input", { ...exact, type: "number", min: "0.01", step: "any", required: "", "data-field": "fontSize" })
      const color = node("input", { ...exact, type: "text", required: "", "data-field": "color" })
      text.value = "Text"; size.value = "24"; color.value = "#ffffff"
      for (const [title, control] of [["Text", text], ["Font size", size], ["Color (#RRGGBB or #RRGGBBAA)", color]]) {
        const label = node("label", {}, title)
        label.append(control); form.append(label)
      }
      const add = node("button", { type: "submit", "data-action": "add-text" }, "Add text object")
      form.append(add)
      element.append(node("legend", {}, "Text"), choose, path, form)
      let active = true, busy = false, source = null
      const update = () => {
        choose.disabled = busy
        for (const control of [text, size, color, add]) control.disabled = busy || source === null
      }
      async function perform(action) {
        if (!active || busy || element.disabled) return
        busy = true; update()
        try { await action() }
        catch (error) {
          if (active) await runtime.call("ui.toast.error", { message: error instanceof Error ? error.message : String(error) })
        } finally { busy = false; if (active) update() }
      }
      function importFont() {
        return perform(async () => {
          const result = unwrap(await runtime.call("ui.popup.open", {
            title: "Import Font JSON", size: "medium", tag: "view-files",
            props: { mode: "chooser", filter: "*.json" },
          }))
          if (!active || !result || result.cancelled) return
          const selection = Array.isArray(result.selection) ? result.selection[0] : result.selection
          assert(selection && typeof selection.path === "string", "Font import requires selected path")
          const document = await readFontDocument(selection.path)
          if (!active) return
          // Validate the linked image before making this source available to add.
          const image = await loadFontImage(document)
          image.close()
          if (!active) return
          source = { path: selection.path, document }
          path.textContent = selection.path
        })
      }
      function submit(event) {
        event.preventDefault()
        if (!source) return
        return perform(async () => {
          const props = { font: source.path, text: text.value, fontSize: Number(size.value), color: color.value }
          const data = textObjectData({ props })
          layoutWorldText(source.document, data.text, data.size, origin)
          await addObject(props)
        })
      }
      choose.addEventListener("click", importFont)
      form.addEventListener("submit", submit)
      update()
      return { element, dispose() {
        active = false
        choose.removeEventListener("click", importFont)
        form.removeEventListener("submit", submit)
      } }
    },

    async prepare(objects) {
      assert(Array.isArray(objects), "text renderer objects must be an array")
      const requested = objects.map(textObjectData), ticket = ++generation
      const next = new Map(), staged = new Set()
      try {
        for (const data of requested) {
          if (!next.has(data.path)) {
            let font = fonts.get(data.path)
            if (!font) {
              const document = await readFontDocument(data.path)
              const image = await loadFontImage(document)
              font = { document, image }; staged.add(font)
            }
            next.set(data.path, font)
          }
          layoutWorldText(next.get(data.path).document, data.text, data.size, origin)
        }
        assert(ticket === generation, "Text preparation superseded")
      } catch (error) {
        for (const font of staged) font.image.close()
        throw error
      }
      const evicted = [...fonts].filter(([path]) => !next.has(path))
      // The GPU cache contains at most one atlas. Release any evicted source texture.
      if (evicted.length && raster) { raster.dispose(); raster = null }
      for (const [, font] of evicted) font.image.close()
      fonts = next
    },

    bounds(object) { return prepared(object).layout.bounds },

    draw(ctx, object, frame) {
      assert(ctx instanceof CanvasRenderingContext2D, "text renderer requires a 2d context")
      assert(frame && Number.isFinite(frame.scale) && frame.scale > 0, "text renderer frame.scale must be positive")
      const { data, font, layout } = prepared(object)
      if (layout.quads.length === 0) return
      if (!raster) raster = createTextRaster()
      raster.draw(ctx, layout, font, data.color)
    },

    dispose() {
      generation++
      if (raster) { raster.dispose(); raster = null }
      for (const font of fonts.values()) font.image.close()
      fonts.clear()
    },
  }
}
