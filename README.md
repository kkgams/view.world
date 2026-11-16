# World View

World editing with configurable object renderers for [GAMS](https://github.com/kkgams/gams).

| View | Source → ZIP entry | Screenshot | License | Original work |
| --- | --- | --- | --- | --- |
| World editor (`view-world`) | `src/views/view-world.js` → `views/view-world.js` | Not available | [Apache-2.0](LICENSE), [notice](NOTICE) | GAMS contributors |

## Development

Requires Make, Node.js 24 (dependency-free syntax checks), Python 3, curl, unzip,
zip and shasum. Local launch requires macOS Apple Silicon and network access on
first use. It loads canonical local source and pinned released supporting Units,
not neighboring checkouts. Use New or Open to load a world. The local Project configures rectangle, sprite, tilemap
and nine-slice renderers; unmatched objects use the built-in point renderer.

| Command | Purpose |
| --- | --- |
| `make build` | Assemble the View and its renderer registry into one Host-loadable module. |
| `make open` | Build, download the released Host if absent, then open local `gams.json`. |
| `make check` | Check canonical and assembled JavaScript syntax. |
| `make test` | Run native renderer, import, registry and spatial-group tests. |
| `make package` | Build `build.nosync/view.world.zip` and `SHA256SUMS`. |
| `make serve-docs DOCS_PORT=8080` | Preview documentation with pinned wiki v1.4.0. |
| `make validate-docs` | Validate documentation. |
| `make docs` | Build `build.nosync/site/`. |
| `make clean` | Remove `build.nosync/`, downloaded `tools/gams.app`, its `tools/gams-release-notices/` and identified configured downloads in `gams_modules/`; preserve supplied Units and refuse unmarked Host tools, tracked files or symlinked deletion paths. |

Existing Host downloads are never updated implicitly; launch does not bypass
Gatekeeper. Optional user inputs in `dev-assets/` are neither packaged nor cleaned.
The ZIP includes `views/view-world.js` and `world-renderers/{rectangle,sprite,tilemap,nine}.js`.
Projects select renderer modules through `$file` archive entries in
`ui.views.view-world.config.renderers`; see [renderer configuration](docs/index.md#renderer-configuration).

Drag table rows before/after objects or into spatial groups to reorder/reparent
whole subtrees while preserving world positions. Arrow buttons and the Parent
selector remain keyboard alternatives. Spatial groups support nested
parent-relative positions and movement. See
[spatial groups](docs/index.md#spatial-groups) for controls, storage and deletion policy.

## Nine-slice objects

The nine renderer supplies its own sidebar panel. Create or open a world, then
use **Import nine-slice JSON** in that panel to select a `gams.nine` version-1 document saved by view.nine. Choose a
named slice, enter Width/Height and click **Add slice object**. The object appears
at the viewport center; adding it is one undoable command. Select another slice
to reset dimensions to its source bounds. Use Properties to edit an existing
object's `slice`, `width` or `height`.

JSON and atlas files must already be inside the Project. Import references the
JSON without copying it; its `image` remains Project-relative, not JSON-relative.
Corners keep their source size and edges/center stretch. Each patch provides
minimum dimensions from its fixed borders; smaller sizes are rejected rather
than scaling those borders. Regions and horizontal/vertical slices are also supported. See [nine-slice rendering](docs/index.md#nine-slice-objects).

## Resize objects

Select a nine-slice, rectangle or sprite and drag a corner or edge handle. Edges
change one dimension; corners change both. Dimensions stop at the renderer
minimum without flipping (one pixel for ordinary rectangles/sprites). Release commits position and width/height together as one undo step;
Escape cancels. Numeric editing remains available through Properties. Spatial
groups, locked objects and renderers without resize support have no handles.
See [resizing](docs/index.md#resize-objects) for anchoring and the renderer API.
