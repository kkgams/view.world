function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function fontProjectPath(path) {
  assert(typeof path === "string" && path.trim().length > 0 && path === path.trim() &&
    !/[\u0000-\u001f\u007f:?#\\]/.test(path) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== ".."),
  "Font asset must be a Project-relative path")
  return path
}

function finite(value, name) {
  assert(typeof value === "number" && Number.isFinite(value), `${name} must be finite`)
  return value
}

function scalar(code) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
}

export function validateFontDocument(doc) {
  assert(doc && doc.format === "gams.font" && doc.version === 1, "Expected gams.font version 1")
  fontProjectPath(doc.image)
  assert(/\.png$/i.test(doc.image), "Font atlas must be PNG")
  const a = doc.atlas, m = doc.metrics
  assert(a && ["sdf", "psdf", "msdf", "mtsdf"].includes(a.type), "Invalid font atlas type")
  assert(Number.isSafeInteger(a.width) && a.width > 0 && Number.isSafeInteger(a.height) && a.height > 0,
    "Invalid font atlas dimensions")
  assert(finite(a.size, "Atlas size") > 0 && finite(a.distanceRange, "Distance range") > 0,
    "Invalid font atlas scale")
  assert(a.distanceRangeMiddle === 0, "Unsupported font distance range middle")
  assert(a.yOrigin === "bottom", "Font atlas yOrigin must be bottom")
  assert(m && finite(m.emSize, "emSize") > 0 && finite(m.lineHeight, "lineHeight") > 0,
    "Invalid font metrics")
  assert(finite(m.ascender, "ascender") > finite(m.descender, "descender"), "Invalid font ascender/descender")
  assert(Array.isArray(doc.glyphs) && Array.isArray(doc.kerning), "Font glyphs and kerning must be arrays")
  const glyphs = new Set()
  for (const g of doc.glyphs) {
    assert(g && scalar(g.unicode) && !glyphs.has(g.unicode), "Invalid or duplicate font glyph Unicode")
    glyphs.add(g.unicode)
    assert(finite(g.advance, "Glyph advance") >= 0, "Glyph advance must be nonnegative")
    assert(Object.hasOwn(g, "planeBounds") === Object.hasOwn(g, "atlasBounds"), "Glyph bounds must be paired")
    if (!Object.hasOwn(g, "planeBounds")) continue
    const p = g.planeBounds, b = g.atlasBounds
    assert(p && b, "Invalid glyph bounds")
    for (const key of ["left", "right", "top", "bottom"]) {
      finite(p[key], `Glyph plane ${key}`)
      finite(b[key], `Glyph atlas ${key}`)
    }
    assert(p.right > p.left && p.top > p.bottom, "Glyph plane bounds must be positive")
    assert(b.left >= 0 && b.bottom >= 0 && b.right > b.left && b.top > b.bottom &&
      b.right <= a.width && b.top <= a.height, "Glyph bounds exceed atlas or are empty")
  }
  const pairs = new Set()
  for (const k of doc.kerning) {
    assert(k && glyphs.has(k.unicode1) && glyphs.has(k.unicode2), "Kerning references missing glyph")
    const key = `${k.unicode1}:${k.unicode2}`
    assert(!pairs.has(key), "Duplicate kerning pair")
    pairs.add(key)
    finite(k.advance, "Kerning advance")
  }
  return doc
}

export function textObjectData(object) {
  assert(object && object.props && typeof object.props === "object", "text renderer requires object props")
  const p = object.props
  const path = fontProjectPath(p.font)
  assert(typeof p.text === "string", "text renderer requires a text string")
  assert((typeof p.fontSize === "number" || (typeof p.fontSize === "string" && p.fontSize.trim() !== "")) &&
    Number.isFinite(Number(p.fontSize)) && Number(p.fontSize) > 0, "text renderer requires positive fontSize")
  assert(typeof p.color === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(p.color),
    "Text color must be #RRGGBB or #RRGGBBAA")
  const hex = p.color.slice(1)
  const color = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  color.push(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1)
  return { path, text: p.text, size: Number(p.fontSize), color }
}

// Positions use a top-left line box. Ink overhangs are included in selection bounds.
// UVs address the conventional top-down exported PNG, not the bottom-up metadata.
export function layoutWorldText(doc, text, size, origin = [0, 0]) {
  assert(typeof text === "string" && Number.isFinite(size) && size > 0, "Invalid text layout input")
  const glyphs = new Map(doc.glyphs.map(g => [g.unicode, g]))
  const kern = new Map(doc.kerning.map(k => [`${k.unicode1}:${k.unicode2}`, k.advance]))
  const unit = size / doc.metrics.emSize
  const lineHeight = doc.metrics.lineHeight * unit
  let x = 0, baseline = doc.metrics.ascender * unit, previous = null, lines = 1
  let minX = 0, minY = 0, maxX = 1, maxY = Math.max(1, lineHeight)
  const quads = []
  for (const char of text.replace(/\r\n/g, "\n")) {
    if (char === "\n") {
      x = 0; baseline += lineHeight; lines++; maxY = Math.max(maxY, lines * lineHeight); previous = null
      continue
    }
    const code = char.codePointAt(0)
    assert(scalar(code), "Text contains an unpaired Unicode surrogate")
    const g = glyphs.get(code)
    assert(g, `Font is missing glyph U+${code.toString(16).toUpperCase().padStart(4, "0")}`)
    if (previous !== null) x += (kern.get(`${previous}:${code}`) || 0) * unit
    if (g.planeBounds) {
      const p = g.planeBounds, a = g.atlasBounds
      const quad = {
        x: x + p.left * unit, y: baseline - p.top * unit,
        width: (p.right - p.left) * unit, height: (p.top - p.bottom) * unit,
        uv: [a.left / doc.atlas.width, (doc.atlas.height - a.top) / doc.atlas.height,
          (a.right - a.left) / doc.atlas.width, (a.top - a.bottom) / doc.atlas.height],
      }
      quads.push(quad)
      minX = Math.min(minX, quad.x); minY = Math.min(minY, quad.y)
      maxX = Math.max(maxX, quad.x + quad.width); maxY = Math.max(maxY, quad.y + quad.height)
    }
    x += g.advance * unit
    maxX = Math.max(maxX, x)
    previous = code
  }
  // Origin refers to the complete measured box, including spaces and blank lines.
  const offsetX = minX + (maxX - minX) * origin[0]
  const offsetY = minY + (maxY - minY) * origin[1]
  for (const q of quads) { q.x -= offsetX; q.y -= offsetY }
  const bounds = { minX: minX - offsetX, minY: minY - offsetY, maxX: maxX - offsetX, maxY: maxY - offsetY }
  assert(Object.values(bounds).every(Number.isFinite) && quads.every(q =>
    [q.x, q.y, q.width, q.height].every(Number.isFinite)), "Text layout exceeds finite dimensions")
  return { bounds, quads }
}
