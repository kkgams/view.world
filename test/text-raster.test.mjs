import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(new URL("../src/text-raster.js", import.meta.url), "utf8")
const { createTextRaster } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

function environment(options = {}) {
    const calls = []
    const listeners = new Map()
    const gl = new Proxy({
        NO_ERROR: 0,
        drawingBufferWidth: 1,
        drawingBufferHeight: 1,
        getParameter(name) { return name === "MAX_VIEWPORT_DIMS" ? [4096, 4096] : 4096 },
        getShaderParameter() { return true },
        getProgramParameter() { return true },
        getUniformLocation(program, name) { return name },
        getError() { return options.error ?? 0 },
        isContextLost() { return options.lost ?? false },
        getExtension() { return { loseContext() { calls.push(["loseContext"]) } } },
    }, {
        get(target, name) {
            if (name in target) return target[name]
            if (/^[A-Z_0-9]+$/.test(name)) return name
            return (...args) => {
                calls.push([name, ...args])
                if (name.startsWith("create")) return name === options.fail ? null : { name }
            }
        },
    })
    const canvas = {
        getContext() { return gl },
        addEventListener(name, callback) { listeners.set(name, callback) },
        removeEventListener(name) { listeners.delete(name) },
        set width(value) { gl.drawingBufferWidth = value },
        get width() { return gl.drawingBufferWidth },
        set height(value) { gl.drawingBufferHeight = value },
        get height() { return gl.drawingBufferHeight },
    }
    globalThis.document = { createElement(name) { assert.equal(name, "canvas"); return canvas } }
    const ctx = {
        getTransform() { return { a: 0, b: 2, c: -3, d: 0 } },
        drawImage(...args) { calls.push(["drawImage", ...args]) },
    }
    const layout = { bounds: { minX: -2, minY: 4, maxX: 8, maxY: 24 }, quads: [{ x: -1, y: 6, width: 3, height: 5, uv: [0.1, 0.2, 0.3, 0.4] }] }
    const font = { document: { atlas: { width: 100, height: 200, distanceRange: 4, type: "mtsdf" } }, image: { width: 100, height: 200 } }
    const color = [0.2, 0.4, 0.6, 0.8]
    const raster = createTextRaster()
    return { calls, listeners, ctx, layout, font, color, raster, canvas }
}

function draw(env) { env.raster.draw(env.ctx, env.layout, env.font, env.color) }

test("raster uses transformed axis lengths, top-left quads, unchanged top-down UVs and world bounds", () => {
    const env = environment()
    draw(env)
    assert.equal(env.canvas.width, 20)
    assert.equal(env.canvas.height, 60)
    assert.deepEqual(env.calls.find(call => call[0] === "uniform4f"), ["uniform4f", "rect", 2, 6, 6, 15])
    assert.deepEqual(env.calls.find(call => call[1] === "atlasRect"), ["uniform4fv", "atlasRect", env.layout.quads[0].uv])
    assert.deepEqual(env.calls.find(call => call[0] === "drawImage"), ["drawImage", env.canvas, -2, 4, 10, 20])
    assert.deepEqual(env.calls.find(call => call[0] === "blendFunc"), ["blendFunc", "ONE", "ONE_MINUS_SRC_ALPHA"])
    assert.deepEqual(env.calls.find(call => call[1] === "multichannel"), ["uniform1i", "multichannel", 1])
    env.raster.dispose()
})

test("one texture is reused, replacing the image uploads without allocating another texture", () => {
    const env = environment()
    draw(env)
    draw(env)
    env.font.image = { width: 100, height: 200 }
    env.font.document.atlas.type = "sdf"
    draw(env)
    assert.equal(env.calls.filter(call => call[0] === "createTexture").length, 1)
    assert.equal(env.calls.filter(call => call[0] === "texImage2D").length, 2)
    assert.deepEqual(env.calls.filter(call => call[1] === "multichannel").at(-1), ["uniform1i", "multichannel", 0])
    env.raster.dispose()
})

test("empty layouts do not allocate GPU resources", () => {
    const env = environment()
    env.layout.quads = []
    draw(env)
    assert.deepEqual(env.calls, [])
    env.raster.dispose()
})

test("oversized raster and atlas are rejected before upload or drawing", () => {
    for (const kind of ["raster", "atlas"]) {
        const env = environment()
        if (kind === "raster") env.layout.bounds.maxX = 10000
        else { env.font.image.width = 5000; env.font.document.atlas.width = 5000 }
        assert.throws(() => draw(env), /exceed.*WebGL/)
        assert.equal(env.calls.filter(call => call[0] === "texImage2D").length, 0)
        env.raster.dispose()
    }
})

test("partial allocation failure deletes every allocated resource and shader", () => {
    const env = environment({ fail: "createBuffer" })
    assert.throws(() => draw(env), /Cannot allocate text raster resources/)
    for (const name of ["deleteTexture", "deleteVertexArray", "deleteProgram"]) {
        assert.equal(env.calls.filter(call => call[0] === name).length, 1)
    }
    assert.equal(env.calls.filter(call => call[0] === "deleteShader").length, 2)
    env.raster.dispose()
})

test("context loss throws; disposal removes listeners and is idempotent", () => {
    const env = environment()
    draw(env)
    env.listeners.get("webglcontextlost")()
    assert.throws(() => draw(env), /context lost/)
    env.raster.dispose()
    env.raster.dispose()
    assert.equal(env.listeners.size, 0)
    for (const name of ["deleteTexture", "deleteBuffer", "deleteVertexArray", "deleteProgram"]) {
        assert.equal(env.calls.filter(call => call[0] === name).length, 1)
    }
    assert.throws(() => draw(env), /disposed/)
})

test("allocation errors and invalid colors fail without copying an incomplete raster", () => {
    const env = environment({ error: 1285 })
    assert.throws(() => draw(env), /WebGL error 1285/)
    assert.equal(env.calls.some(call => call[0] === "drawImage"), false)
    env.raster.dispose()
    const invalid = environment()
    invalid.color = "#ffffff"
    assert.throws(() => draw(invalid), /RGBA/)
    invalid.raster.dispose()
})
