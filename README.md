# World View

World editing with configurable object renderers for [GAMS](https://github.com/kkgams/gams).

| View | Source → ZIP entry | Screenshot | License | Original work |
| --- | --- | --- | --- | --- |
| World editor (`view-world`) | `src/views/view-world.js` → `views/view-world.js` | Not available | [Apache-2.0](LICENSE), [notice](NOTICE) | GAMS contributors |

## Development

Requires Make, Node.js 24 (dependency-free syntax checks), Python 3, curl, unzip,
zip and shasum. Local launch requires macOS Apple Silicon and network access on
first use. It loads canonical local source and pinned released supporting Units,
not neighboring checkouts. Use New or Open to load a world. The local Project
uses the built-in point renderer; additional renderers must be configured explicitly.

| Command | Purpose |
| --- | --- |
| `make open` | Download the released Host if absent, then open local `gams.json`. |
| `make check` | Check JavaScript syntax. |
| `make package` | Build `build.nosync/view.world.zip` and `SHA256SUMS`. |
| `make serve-docs DOCS_PORT=8080` | Preview documentation with pinned wiki v1.4.0. |
| `make validate-docs` | Validate documentation. |
| `make docs` | Build `build.nosync/site/`. |
| `make clean` | Remove `build.nosync/`, downloaded `tools/gams.app`, its `tools/gams-release-notices/` and identified configured downloads in `gams_modules/`; preserve supplied Units and refuse unmarked Host tools, tracked files or symlinked deletion paths. |

Existing Host downloads are never updated implicitly; launch does not bypass
Gatekeeper. Optional user inputs in `dev-assets/` are neither packaged nor cleaned.
See [runtime requirements](docs/index.md#runtime-requirements).
