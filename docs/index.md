---
title: World View
status: reference
---

# World View

World editing with configurable object renderers for [GAMS](https://github.com/kkgams/gams).

| View | Source → ZIP entry | Screenshot | Original work |
| --- | --- | --- | --- |
| World editor (`view-world`) | `src/views/view-world.js` → `views/view-world.js` | Not available | GAMS contributors |

## Development

Requires Make, Node.js 24, Python 3, curl, zip, unzip and shasum. Launch requires
macOS Apple Silicon. Supporting Units are pinned in `gams.json`; no sibling
checkout is needed. Use New or Open to load a world. File selection and properties
use pinned released Views.

| Command | Purpose |
| --- | --- |
| `make build` | Assemble the View and renderer registry into `build.nosync/views/view-world.js`. |
| `make open` | Build and open the local Project in the released Host with explicit `GAMS_APP_CWD` and `GAMS_CONFIG`. |
| `make check` | Check canonical and assembled JavaScript syntax without dependencies. |
| `make test` | Run native renderer and registry tests. |
| `make package` | Build `view.world.zip` and `SHA256SUMS` under `build.nosync/`. |
| `make serve-docs DOCS_PORT=8080` | Preview this wiki with pinned justgook/wiki v1.4.0. |
| `make validate-docs` | Validate wiki content. |
| `make docs` | Build `build.nosync/site/`. |
| `make clean` | Delete generated `build.nosync/`, downloaded Host and notices under `tools/`, and identified configured downloads in `gams_modules/`; preserve supplied Units and refuse unmarked Host tools, tracked files and symlinked deletion paths. |

First launch needs network access and preserves notices beside `tools/gams.app`.
Existing downloads are not updated implicitly and Gatekeeper is not bypassed.
User inputs in `dev-assets/` are neither packaged nor cleaned. Make assembles the
canonical View and its registry into one module because Host-loaded Views use
blob URLs; relative imports cannot locate neighboring archive files.

## Runtime requirements

Remote `$file` configuration requires GAMS v3.2.0 or newer. The View requires browser
DOM, custom elements, Host semantic CSS and configured plugin/service providers.
Missing required APIs, configuration or schemas are errors, not optional features.
The local Project supplies filesystem/layout plugins, UI Services, file chooser
and properties Views through explicit released pins.

The View owns its renderer registry. Host-owned imports include `/core/runtime.js`,
`/util/undo.js`, `/util/view-canvas-base.js`, `/util/require.js`,
`/util/qoi/decode.js` and `/util/tilemap-render.js`; their implementations are not
bundled in the View ZIP.

## Renderer configuration

The ZIP contains `views/view-world.js` (including the registry) and three separate
browser modules under `world-renderers/`. They are not WASM plugins or a separate
Project Unit category. Projects explicitly select modules in
`ui.views.view-world.config.renderers`; there is no automatic discovery.

The local Project uses canonical renderer files under `src/world-renderers/`.
A consuming Project can select a renderer from the same released ZIP as the View:

```json
{
  "sprite": {
    "url": {
      "$file": {
        "url": "https://github.com/kkgams/view.world/releases/download/vNEXT/view.world.zip",
        "entry": "world-renderers/sprite.js"
      }
    },
    "match": { "render": "sprite" },
    "config": { "origin": [0.5, 0.5] }
  }
}
```

Place this mapping under `ui.views.view-world.config.renderers`. `vNEXT` is a
placeholder: replace it with an explicitly pinned release that includes these
modules. v0.2.1 and earlier do not contain them. Use the same tag/archive URL for
the View entry (`views/view-world.js`) and renderer entries; the Host downloads
and extracts that archive once. `$file` resolves to a Project-accessible local
path before the registry loads the module through the configured filesystem
plugin. Bare remote URLs are not accepted by that loader.

Every `match` entry compares an object property using exact string equality;
multiple entries use AND. No match uses the built-in point renderer; multiple
matches are an error. Stored world objects have flat properties, for example
`{"x": 0, "y": 0, "render": "rectangle", "width": 32, "height": 16, "color": "red"}`.
The View exposes those authored properties as `object.props` to renderers.

| Renderer / match | Required object properties | Optional properties |
| --- | --- | --- |
| `rectangle.js` / `render: "rectangle"` | Positive `width`, `height`; CSS `color`. | None. |
| `sprite.js` / `render: "sprite"` | `url` for a Project image, or `width`, `height`, `color` for a rectangle. | Paired `width`/`height` override natural image size. QOI, PNG, JPEG, WebP, GIF and BMP are supported. |
| `tilemap.js` / `render: "tilemap"` | `tilemap`: Project-relative tilemap path. | Positive one-based `layer`; `repeat: [x, y]` with 0/1 flags for infinite viewport repetition. |

All three accept `config.origin: [x, y]`, normalized from 0 to 1; omission means
top-left `[0, 0]`. The local Project uses top-left rectangles, centered sprites
and bottom-left tilemaps. Repeated tilemaps retain one copy's finite bounds for
selection and fit-to-content.

Custom modules export `createWorldObjectRenderer({ config })`, returning
`prepare(objects)`, `draw(ctx, object, frame)`, `bounds(object)` and `dispose()`.
Preparation can be asynchronous; drawing is synchronous. Bounds are object-local
`{minX, minY, maxX, maxY}` with finite coordinates and positive dimensions. The
registry translates the canvas to the object's position before drawing. The View
owns ordering, selection, hit testing and viewport state. `frame` supplies
`scale`, `label` and object-local `viewport` bounds.

Custom property inputs belong in `config.inputs`; axis inversion belongs in
`config.invert`. Both inversions are disabled in the local Project.
Native tests cover renderer/registry behavior, not native GUI editing, undo or
full configured plugin integration.
