import { runtime, unwrap } from "/core/runtime.js"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function projectPath(path, label) {
  assert(
    typeof path === "string" && path.trim().length > 0 &&
      !path.includes(":") && !path.includes("\\") &&
      path.split("/").every(part => part !== "" && part !== "." && part !== ".."),
    `${label} must be a Project-relative path`,
  )
  return path
}

// This renderer owns its small reader contract: it has no sibling Unit imports.
// Unknown metadata is retained, as in the gams.nine version-1 editor model.
function validateDocument(document) {
  assert(document && document.format === "gams.nine" && document.version === 1,
    "Expected gams.nine version 1")
  projectPath(document.image, "Atlas")
  assert(Array.isArray(document.slices), "Slices must be an array")
  const names = new Set()
  for (const slice of document.slices) {
    assert(slice && typeof slice.name === "string" && slice.name.trim().length > 0,
      "Slice name is required")
    assert(!names.has(slice.name), `Duplicate slice name: ${slice.name}`)
    names.add(slice.name)
    assert(["region", "horizontal", "vertical", "nine"].includes(slice.type),
      `Unknown slice type: ${slice.type}`)
    const region = slice.type === "region"
    assert(!region || !("center" in slice), `${slice.name}: region must omit center`)
    for (const key of region ? ["bounds"] : ["bounds", "center"]) {
      const rect = slice[key]
      assert(rect && ["x", "y", "width", "height"].every(field => Number.isSafeInteger(rect[field])),
        `${slice.name}: ${key} must use integer pixels`)
      assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0,
        `${slice.name}: ${key} must be positive and non-empty`)
    }
    if (!region) {
      const b = slice.bounds, c = slice.center
      assert(c.width <= b.width - c.x && c.height <= b.height - c.y,
        `${slice.name}: center must fit inside bounds`)
      assert(slice.type !== "vertical" || (c.x === 0 && c.width === b.width),
        `${slice.name}: inactive x axis must span bounds`)
      assert(slice.type !== "horizontal" || (c.y === 0 && c.height === b.height),
        `${slice.name}: inactive y axis must span bounds`)
    }
  }
  return document
}

export async function readNineDocument(path) {
  projectPath(path, "Nine document")
  const text = unwrap(await runtime.invoke("fs/fs::read-text", path))
  return validateDocument(JSON.parse(text))
}

async function loadAtlas(path) {
  const ext = path.split(".").pop().toLowerCase()
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext]
  assert(mime, `nine renderer unsupported image extension: ${ext}`)
  const bytes = new Uint8Array(unwrap(await runtime.invoke("fs/fs::read-file", path)))
  const source = await createImageBitmap(new Blob([bytes], { type: mime }))
  try {
    assert(Number.isFinite(source.width) && source.width > 0 &&
      Number.isFinite(source.height) && source.height > 0,
    `nine renderer atlas ${path} must have positive dimensions`)
    return source
  } catch (error) {
    source.close()
    throw error
  }
}

function objectData(object) {
  assert(object && object.props && typeof object.props === "object", "nine renderer requires object props")
  const props = object.props
  const path = projectPath(props.nine, "Nine document")
  assert(typeof props.slice === "string" && props.slice.trim().length > 0,
    "nine renderer slice property must be a non-empty string")
  const size = {}
  for (const axis of ["width", "height"]) {
    const value = props[axis]
    assert((typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
      Number.isFinite(Number(value)) && Number(value) > 0,
    `nine renderer requires positive numeric ${axis} property`)
    size[axis] = Number(value)
  }
  return { path, name: props.slice, ...size }
}

export function nineSliceLimits(slice) {
  const b = slice.bounds
  if (slice.type === "region") return { minWidth: 1, minHeight: 1 }
  const c = slice.center
  return {
    minWidth: slice.type === "vertical" ? b.width : Math.max(1, b.width - c.width),
    minHeight: slice.type === "horizontal" ? b.height : Math.max(1, b.height - c.height),
  }
}

function validateSize(size, slice) {
  const { minWidth, minHeight } = nineSliceLimits(slice)
  assert(size.width >= minWidth && size.height >= minHeight,
    `nine renderer slice ${slice.name} requires minimum width ${minWidth} and height ${minHeight}`)
}

// Each entry is [source offset, source length, destination offset, destination length].
function segments(length, start, center, target, active) {
  if (!active) return [[0, length, 0, target]]
  const end = length - start - center
  const fixed = start + end
  const middle = target - fixed
  return [[0, start, 0, start], [start, center, start, middle],
    [start + center, end, target - end, end]]
}

export function createWorldObjectRenderer({ config }) {
  assert(config && typeof config === "object" && !Array.isArray(config),
    "nine renderer config must be an object")
  const origin = config.origin === undefined ? [0, 0] : config.origin
  assert(Array.isArray(origin) && origin.length === 2 &&
    Array.from(origin).every(value => Number.isFinite(value) && value >= 0 && value <= 1),
  "nine renderer config.origin must be [x, y] between 0 and 1")
  const [originX, originY] = origin
  let documents = new Map(), images = new Map(), generation = 0

  function prepared(object) {
    const data = objectData(object)
    const document = documents.get(data.path)
    assert(document, `nine renderer document not prepared: ${data.path}`)
    const slice = document.slices.find(slice => slice.name === data.name)
    assert(slice, `nine renderer slice not found: ${data.name}`)
    const source = images.get(document.image)
    assert(source, `nine renderer atlas not prepared: ${document.image}`)
    validateSize(data, slice)
    return { ...data, slice, source }
  }

  return {
    createSidebarPanel({ addObject }) {
      assert(typeof addObject === "function", "nine panel requires addObject()")
      const node = (tag, attributes = {}, text) => {
        const element = document.createElement(tag)
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
        if (text !== undefined) element.textContent = text
        return element
      }
      const element = node("fieldset", { "data-element": "nine-slice" })
      const importButton = node("button", { type: "button", "data-action": "import-nine" }, "Import nine-slice JSON")
      const pathOutput = node("output", { "data-element": "nine-path" }, "No slice document imported")
      const form = node("form", { "data-element": "nine-form" })
      const select = node("select", { "data-field": "nine-slice", "aria-label": "Slice" })
      const dimension = axis => node("input", {
        type: "number", min: "1", step: "1", required: "", "data-field": `nine-${axis}`,
        autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false",
      })
      const width = dimension("width"), height = dimension("height")
      for (const [title, control] of [["Slice", select], ["Width", width], ["Height", height]]) {
        const label = node("label", {}, `${title} `)
        label.append(control)
        form.append(label)
      }
      const addButton = node("button", { type: "submit", "data-action": "add-nine" }, "Add slice object")
      form.append(addButton)
      element.append(node("legend", {}, "Nine slice"), importButton, pathOutput, form)
      let active = true, busy = false, source = null
      const controls = [select, width, height, addButton]
      function updateControls() {
        importButton.disabled = busy
        for (const control of controls) control.disabled = busy || !source
      }
      function selectedSlice() {
        assert(source, "nine panel requires imported source")
        const slice = source.document.slices.find(slice => slice.name === select.value)
        assert(slice, `nine panel missing imported slice ${select.value}`)
        return slice
      }
      function resetDimensions() {
        if (!active || busy || element.disabled) return
        const slice = selectedSlice()
        const limits = nineSliceLimits(slice)
        width.min = String(limits.minWidth)
        height.min = String(limits.minHeight)
        width.value = String(slice.bounds.width)
        height.value = String(slice.bounds.height)
      }
      async function perform(action) {
        if (!active || busy || element.disabled) return
        busy = true
        updateControls()
        try {
          await action()
        } catch (error) {
          if (active) await runtime.call("ui.toast.error", { message: error instanceof Error ? error.message : String(error) })
        } finally {
          busy = false
          if (active) updateControls()
        }
      }
      function importSource() {
        return perform(async () => {
          const payload = unwrap(await runtime.call("ui.popup.open", {
            title: "Import Nine-slice JSON", size: "medium", tag: "view-files",
            props: { mode: "chooser", filter: "*.json" },
          }))
          if (!active || !payload || payload.cancelled) return
          const selection = Array.isArray(payload.selection) ? payload.selection[0] : payload.selection
          assert(selection && typeof selection.path === "string", "nine panel import requires selected path")
          const document = await readNineDocument(selection.path)
          if (!active) return
          assert(document.slices.length > 0, "Nine-slice document contains no slices")
          source = { path: selection.path, document }
          select.replaceChildren(...document.slices.map(slice => node("option", { value: slice.name }, slice.name)))
          select.value = document.slices[0].name
          pathOutput.textContent = selection.path
          const slice = selectedSlice(), limits = nineSliceLimits(slice)
          width.min = String(limits.minWidth)
          height.min = String(limits.minHeight)
          width.value = String(slice.bounds.width)
          height.value = String(slice.bounds.height)
          await runtime.call("ui.toast.success", { message: `Imported ${selection.path}` })
        })
      }
      function submit(event) {
        event.preventDefault()
        if (!source) return
        return perform(async () => {
          const slice = selectedSlice(), limits = nineSliceLimits(slice)
          const w = Number(width.value), h = Number(height.value)
          assert(Number.isSafeInteger(w) && w > 0, "Slice width must be a positive integer")
          assert(Number.isSafeInteger(h) && h > 0, "Slice height must be a positive integer")
          assert(w >= limits.minWidth && h >= limits.minHeight, `Slice minimum is ${limits.minWidth} × ${limits.minHeight}`)
          await addObject({ nine: source.path, slice: slice.name, width: w, height: h })
          if (active) await runtime.call("ui.toast.success", { message: `Added slice ${slice.name}` })
        })
      }
      importButton.addEventListener("click", importSource)
      select.addEventListener("change", resetDimensions)
      form.addEventListener("submit", submit)
      updateControls()
      return {
        element,
        dispose() {
          active = false
          importButton.removeEventListener("click", importSource)
          select.removeEventListener("change", resetDimensions)
          form.removeEventListener("submit", submit)
        },
      }
    },

    async prepare(objects) {
      assert(Array.isArray(objects), "nine renderer objects must be array")
      const requested = objects.map(objectData)
      const ticket = ++generation
      const nextDocuments = new Map(), nextImages = new Map(), stagedImages = new Map()
      try {
        for (const { path } of requested) {
          if (nextDocuments.has(path)) continue
          const document = documents.has(path) ? documents.get(path) : await readNineDocument(path)
          nextDocuments.set(path, document)
          if (!nextImages.has(document.image)) {
            const cached = images.get(document.image)
            const source = cached || await loadAtlas(document.image)
            if (!cached) stagedImages.set(document.image, source)
            nextImages.set(document.image, source)
          }
          const source = nextImages.get(document.image)
          for (const { name, bounds: b } of document.slices) {
            assert(b.width <= source.width - b.x && b.height <= source.height - b.y,
              `${name}: bounds exceed atlas`)
          }
        }
        for (const data of requested) {
          const slice = nextDocuments.get(data.path).slices.find(slice => slice.name === data.name)
          assert(slice, `nine renderer slice not found: ${data.name}`)
          validateSize(data, slice)
        }
        assert(ticket === generation, "nine renderer preparation superseded")
      } catch (error) {
        for (const source of stagedImages.values()) source.close()
        throw error
      }
      for (const [path, source] of images) {
        if (!nextImages.has(path)) source.close()
      }
      documents = nextDocuments
      images = nextImages
    },

    draw(ctx, object, frame) {
      assert(ctx instanceof CanvasRenderingContext2D, "nine renderer requires 2d context")
      assert(frame && Number.isFinite(frame.scale) && frame.scale > 0,
        "nine renderer frame.scale must be positive")
      const { width, height, slice, source } = prepared(object)
      const b = slice.bounds
      const c = slice.type === "region" ? { x: 0, y: 0, width: b.width, height: b.height } : slice.center
      const xs = segments(b.width, c.x, c.width, width, slice.type === "horizontal" || slice.type === "nine")
      const ys = segments(b.height, c.y, c.height, height, slice.type === "vertical" || slice.type === "nine")
      ctx.imageSmoothingEnabled = false
      for (const [sy, sh, dy, dh] of ys) {
        for (const [sx, sw, dx, dw] of xs) {
          if (sw === 0 || sh === 0 || dw === 0 || dh === 0) continue
          ctx.drawImage(source, b.x + sx, b.y + sy, sw, sh,
            dx - width * originX, dy - height * originY, dw, dh)
        }
      }
    },

    resizeLimits(object) {
      return nineSliceLimits(prepared(object).slice)
    },

    resize(object, size) {
      for (const field of ["width", "height"]) {
        assert(
          size && Number.isFinite(size[field]) && size[field] > 0,
          "nine renderer resize " + field + " must be a positive finite number",
        )
      }
      validateSize(size, prepared(object).slice)
      return { width: size.width, height: size.height }
    },

    bounds(object) {
      const { width, height } = prepared(object)
      const minX = -width * originX, minY = -height * originY
      return { minX, minY, maxX: minX + width, maxY: minY + height }
    },

    dispose() {
      generation++
      for (const source of images.values()) source.close()
      images.clear()
      documents.clear()
    },
  }
}
