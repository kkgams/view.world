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
  if (slice.type === "region") return { minWidth: b.width, maxWidth: b.width, minHeight: b.height, maxHeight: b.height }
  const c = slice.center
  return {
    minWidth: slice.type === "vertical" ? b.width : Math.max(1, b.width - c.width),
    minHeight: slice.type === "horizontal" ? b.height : Math.max(1, b.height - c.height),
    ...(slice.type === "horizontal" ? { maxHeight: b.height } : slice.type === "vertical" ? { maxWidth: b.width } : {}),
  }
}

function validateSize(size, slice) {
  const { minWidth, minHeight, maxWidth, maxHeight } = nineSliceLimits(slice)
  assert(size.width >= minWidth && size.height >= minHeight,
    `nine renderer slice ${slice.name} requires minimum width ${minWidth} and height ${minHeight}`)
  if (maxWidth !== undefined) assert(size.width <= maxWidth,
    `nine renderer slice ${slice.name} requires maximum width ${maxWidth}`)
  if (maxHeight !== undefined) assert(size.height <= maxHeight,
    `nine renderer slice ${slice.name} requires maximum height ${maxHeight}`)
}

// Each entry is [source offset, destination offset, shared length].
function segments(length, start, center, target, active, min, max) {
  const spans = []
  function add(source, dest, size) {
    if (size > 0 && dest < max && dest + size > min) spans.push([source, dest, size])
  }
  if (!active) {
    add(0, 0, length)
    return spans
  }
  const end = length - start - center
  const middle = target - (start + end)
  add(0, 0, start)
  // Skip offscreen repeats without changing where the tile sequence starts.
  const first = Math.max(0, Math.floor((min - start) / center))
  const stop = Math.ceil(Math.min(middle, max - start) / center)
  for (let tile = first; tile < stop; tile++) {
    const offset = tile * center
    add(start, start + offset, Math.min(center, middle - offset))
  }
  add(start + center, target - end, end)
  return spans
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
      let active = true, busy = false, source = null, dimensionLimits = null
      const controls = [select, width, height, addButton]
      function updateControls() {
        importButton.disabled = busy
        for (const control of controls) control.disabled = busy || !source
        if (dimensionLimits) {
          width.disabled ||= dimensionLimits.maxWidth === dimensionLimits.minWidth
          height.disabled ||= dimensionLimits.maxHeight === dimensionLimits.minHeight
        }
      }
      function selectedSlice() {
        assert(source, "nine panel requires imported source")
        const slice = source.document.slices.find(slice => slice.name === select.value)
        assert(slice, `nine panel missing imported slice ${select.value}`)
        return slice
      }
      function setDimensions() {
        const slice = selectedSlice()
        dimensionLimits = nineSliceLimits(slice)
        for (const [control, axis] of [[width, "Width"], [height, "Height"]]) {
          control.setAttribute("min", String(dimensionLimits[`min${axis}`]))
          const maximum = dimensionLimits[`max${axis}`]
          if (maximum === undefined) control.removeAttribute("max")
          else control.setAttribute("max", String(maximum))
        }
        width.value = String(slice.bounds.width)
        height.value = String(slice.bounds.height)
      }
      function resetDimensions() {
        if (!active || busy || element.disabled) return
        setDimensions()
        updateControls()
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
          setDimensions()
          await runtime.call("ui.toast.success", { message: `Imported ${selection.path}` })
        })
      }
      function submit(event) {
        event.preventDefault()
        if (!source) return
        return perform(async () => {
          const slice = selectedSlice()
          const w = Number(width.value), h = Number(height.value)
          assert(Number.isSafeInteger(w) && w > 0, "Slice width must be a positive integer")
          assert(Number.isSafeInteger(h) && h > 0, "Slice height must be a positive integer")
          validateSize({ width: w, height: h }, slice)
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
      const x = width * originX, y = height * originY
      const viewport = frame.viewport
      if (viewport !== undefined) {
        assert(viewport && [viewport.minX, viewport.minY, viewport.maxX, viewport.maxY].every(Number.isFinite),
          "nine renderer frame.viewport must have finite bounds")
      }
      const xs = segments(b.width, c.x, c.width, width, slice.type === "horizontal" || slice.type === "nine",
        viewport === undefined ? 0 : viewport.minX + x, viewport === undefined ? width : viewport.maxX + x)
      const ys = segments(b.height, c.y, c.height, height, slice.type === "vertical" || slice.type === "nine",
        viewport === undefined ? 0 : viewport.minY + y, viewport === undefined ? height : viewport.maxY + y)
      ctx.imageSmoothingEnabled = false
      for (const [sy, dy, h] of ys) {
        for (const [sx, dx, w] of xs) {
          ctx.drawImage(source, b.x + sx, b.y + sy, w, h, dx - x, dy - y, w, h)
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
      const { slice } = prepared(object)
      assert(slice.type !== "region", "nine renderer region does not support resizing")
      validateSize(size, slice)
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
