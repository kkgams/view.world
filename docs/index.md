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
| `make open` | Open local source in the released Host with explicit `GAMS_APP_CWD` and `GAMS_CONFIG`. |
| `make check` | Check JavaScript syntax without dependencies. |
| `make package` | Build `view.world.zip` and `SHA256SUMS` under `build.nosync/`. |
| `make serve-docs DOCS_PORT=8080` | Preview this wiki with pinned justgook/wiki v1.4.0. |
| `make validate-docs` | Validate wiki content. |
| `make docs` | Build `build.nosync/site/`. |
| `make clean` | Delete generated `build.nosync/`, downloaded Host and notices under `tools/`, and identified configured downloads in `gams_modules/`; preserve supplied Units and refuse unmarked Host tools, tracked files and symlinked deletion paths. |

First launch needs network access and preserves notices beside `tools/gams.app`.
Existing downloads are not updated implicitly and Gatekeeper is not bypassed.
User inputs in `dev-assets/` are neither packaged nor cleaned. JavaScript loads
directly from `src/views/`; there is no compilation step.

## Runtime requirements

The original integration contract targets GAMS 2.0.3. The View requires browser
DOM, custom elements, Host semantic CSS and configured plugin/service providers.
Missing required APIs, configuration or schemas are errors, not optional features.
The local Project supplies filesystem/layout plugins, UI Services, file chooser
and properties Views through explicit released pins.

Host-owned imports are `/core/runtime.js`, `/util/undo.js`,
`/util/view-canvas-base.js` and `/util/world-object-renderers.js`; their
implementations are not bundled in the View ZIP.

The local Project uses the built-in point renderer. Configure additional renderer
modules in `ui.views.view-world.config.renderers`, custom property inputs in
`config.inputs`, and axis inversion in `config.invert`. The provided configuration
starts with empty renderer/input mappings and both axis inversions disabled.

Syntax checks do not verify native GUI editing, undo, object renderers or
configured plugin calls.
