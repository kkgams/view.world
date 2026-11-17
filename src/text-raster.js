/*!
 * Adapted from the original web/font-renderer-core.js distance-field shaders.
 * MIT License — Copyright (c) 2020 - 2025 Viktor Chlumsky
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Raw Artery channels and UVs are bottom-up. Never premultiply or color-convert.
const textRasterVertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 unit;
uniform vec2 resolution;
uniform vec4 rect;
uniform vec4 atlasRect;
out vec2 uv;
void main() {
    uv = atlasRect.xy + unit * atlasRect.zw;
    vec2 position = rect.xy + unit * rect.zw;
    gl_Position = vec4((position / resolution * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
}`

const textRasterFragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D atlasImage;
uniform vec2 atlasSize;
uniform float distanceRange;
uniform bool multichannel;
uniform vec4 color;
out vec4 fragment;
float median(float r, float g, float b) { return max(min(r,g),min(max(r,g),b)); }
void main() {
    vec3 sampleValue = texture(atlasImage, uv).rgb;
    float distance = (multichannel ? median(sampleValue.r, sampleValue.g, sampleValue.b) : sampleValue.r) - 0.5;
    vec2 unitRange = vec2(distanceRange) / atlasSize;
    vec2 screenTexSize = vec2(1.0) / fwidth(uv);
    float screenRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
    float alpha = color.a * clamp(distance * screenRange + 0.5, 0.0, 1.0);
    fragment = vec4(color.rgb * alpha, alpha);
}`

function textRasterRequire(condition, message) {
    if (!condition) throw new Error(message)
}

export function createTextRaster() {
    const canvas = document.createElement("canvas")
    let gl = null
    let program = null
    let vao = null
    let buffer = null
    let texture = null
    let currentPixels = null
    let uniforms = null
    let limits = null
    let disposed = false
    let lost = false
    const onLost = () => { lost = true; currentPixels = null }
    canvas.addEventListener("webglcontextlost", onLost)

    function checkError(operation) {
        textRasterRequire(!lost && !gl.isContextLost(), "Text raster WebGL context lost; dispose and recreate the renderer")
        const error = gl.getError()
        textRasterRequire(error === gl.NO_ERROR, `Text raster ${operation} failed (WebGL error ${error})`)
    }

    function release() {
        currentPixels = null
        if (gl !== null) {
            if (texture !== null) gl.deleteTexture(texture)
            if (buffer !== null) gl.deleteBuffer(buffer)
            if (vao !== null) gl.deleteVertexArray(vao)
            if (program !== null) gl.deleteProgram(program)
        }
        texture = buffer = vao = program = null
    }

    function compile(type, source) {
        const shader = gl.createShader(type)
        textRasterRequire(shader !== null, "Cannot allocate text raster shader")
        try {
            gl.shaderSource(shader, source)
            gl.compileShader(shader)
            textRasterRequire(gl.getShaderParameter(shader, gl.COMPILE_STATUS), `Text raster shader: ${gl.getShaderInfoLog(shader)}`)
            return shader
        } catch (error) {
            gl.deleteShader(shader)
            throw error
        }
    }

    function initialize() {
        gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })
        textRasterRequire(gl !== null, "Text raster requires WebGL 2")
        const shaders = []
        try {
            limits = {
                texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                renderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
                viewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
            }
            program = gl.createProgram()
            textRasterRequire(program !== null, "Cannot allocate text raster program")
            shaders.push(compile(gl.VERTEX_SHADER, textRasterVertexSource))
            shaders.push(compile(gl.FRAGMENT_SHADER, textRasterFragmentSource))
            for (const shader of shaders) gl.attachShader(program, shader)
            gl.linkProgram(program)
            textRasterRequire(gl.getProgramParameter(program, gl.LINK_STATUS), `Text raster program: ${gl.getProgramInfoLog(program)}`)
            for (const shader of shaders) gl.detachShader(program, shader)
            vao = gl.createVertexArray()
            buffer = gl.createBuffer()
            texture = gl.createTexture()
            textRasterRequire(vao !== null && buffer !== null && texture !== null, "Cannot allocate text raster resources")
            gl.bindVertexArray(vao)
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
            gl.enableVertexAttribArray(0)
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
            uniforms = Object.fromEntries(["resolution", "rect", "atlasRect", "atlasImage", "atlasSize", "distanceRange", "multichannel", "color"].map(name => {
                const location = gl.getUniformLocation(program, name)
                textRasterRequire(location !== null, `Missing text raster uniform ${name}`)
                return [name, location]
            }))
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            checkError("initialization")
        } catch (error) {
            release()
            throw error
        } finally {
            for (const shader of shaders) gl.deleteShader(shader)
        }
    }

    function draw(ctx, layout, font, color) {
        textRasterRequire(!disposed, "Text raster is disposed")
        textRasterRequire(!lost && (gl === null || !gl.isContextLost()), "Text raster WebGL context lost; dispose and recreate the renderer")
        textRasterRequire(Array.isArray(color) && color.length === 4 && color.every(value => Number.isFinite(value) && value >= 0 && value <= 1), "Text raster color must be RGBA in [0, 1]")
        const { minX, minY, maxX, maxY } = layout.bounds
        const width = maxX - minX
        const height = maxY - minY
        textRasterRequire([minX, minY, maxX, maxY, width, height].every(Number.isFinite) && width >= 0 && height >= 0, "Invalid text raster bounds")
        if (layout.quads.length === 0 || width === 0 || height === 0) return
        const transform = ctx.getTransform()
        const scaleX = Math.hypot(transform.a, transform.b)
        const scaleY = Math.hypot(transform.c, transform.d)
        textRasterRequire(Number.isFinite(scaleX) && Number.isFinite(scaleY), "Invalid text raster transform")
        if (scaleX === 0 || scaleY === 0) return
        const pixelWidth = Math.ceil(width * scaleX)
        const pixelHeight = Math.ceil(height * scaleY)
        if (program === null) initialize()
        textRasterRequire(Number.isSafeInteger(pixelWidth) && Number.isSafeInteger(pixelHeight) && pixelWidth <= Math.min(limits.texture, limits.renderbuffer, limits.viewport[0]) && pixelHeight <= Math.min(limits.texture, limits.renderbuffer, limits.viewport[1]), "Text raster bounds exceed WebGL texture/renderbuffer/viewport limits")
        const atlas = font.document.atlas
        textRasterRequire(font.pixels instanceof Uint8Array && [1, 3, 4].includes(font.channels) &&
            font.pixels.length === atlas.width * atlas.height * font.channels, "Invalid text atlas pixels")
        textRasterRequire(atlas.width <= limits.texture && atlas.height <= limits.texture, "Text atlas exceeds WebGL texture limit")
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight
        textRasterRequire(gl.drawingBufferWidth === pixelWidth && gl.drawingBufferHeight === pixelHeight, "Cannot allocate text raster drawing buffer")
        gl.viewport(0, 0, pixelWidth, pixelHeight)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (currentPixels !== font.pixels) {
            const [internal, format] = font.channels === 1 ? [gl.R8, gl.RED] :
                font.channels === 3 ? [gl.RGB8, gl.RGB] : [gl.RGBA8, gl.RGBA]
            currentPixels = null
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, atlas.width, atlas.height, 0, format, gl.UNSIGNED_BYTE, font.pixels)
            checkError("atlas upload")
            currentPixels = font.pixels
        }
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.uniform1i(uniforms.atlasImage, 0)
        gl.uniform2f(uniforms.resolution, pixelWidth, pixelHeight)
        gl.uniform2f(uniforms.atlasSize, atlas.width, atlas.height)
        gl.uniform1f(uniforms.distanceRange, atlas.distanceRange)
        gl.uniform1i(uniforms.multichannel, atlas.type === "msdf" || atlas.type === "mtsdf" ? 1 : 0)
        gl.uniform4fv(uniforms.color, color)
        for (const quad of layout.quads) {
            gl.uniform4f(uniforms.rect, (quad.x - minX) * pixelWidth / width, (quad.y - minY) * pixelHeight / height, quad.width * pixelWidth / width, quad.height * pixelHeight / height)
            gl.uniform4fv(uniforms.atlasRect, quad.uv)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
        checkError("draw")
        ctx.drawImage(canvas, minX, minY, width, height)
    }

    function dispose() {
        if (disposed) return
        disposed = true
        canvas.removeEventListener("webglcontextlost", onLost)
        release()
        canvas.width = canvas.height = 1
        if (gl !== null && !gl.isContextLost()) {
            const extension = gl.getExtension("WEBGL_lose_context")
            if (extension !== null) extension.loseContext()
        }
    }

    return { draw, dispose }
}
