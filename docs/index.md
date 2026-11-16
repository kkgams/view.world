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
| `make test` | Run native renderer, registry and spatial-group tests. |
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

## Spatial groups

Use **Add group** to create a translation-only group at the viewport center.
Select an object or group, then choose its **Parent** in the position inspector.
Choosing **World (no parent)** detaches it. Reparenting keeps the selected record
and its descendants at the same world positions; self/descendant parents are
excluded. Edit group names through Properties (`name`).

Click a group heading, or focus it and press Enter/Space, to select it and toggle
its nested sidebar rows. Collapsing affects only the sidebar, never canvas
visibility. On the canvas, select/drag a group by its origin marker or bounds
border; the interior remains available for selecting children. Selected group
borders take hit priority. Empty groups still have an origin marker. Position X/Y
are integer offsets **relative to the parent**; moving a group by dragging or
Apply translates all descendants without changing their local offsets. Axis
inversion also applies to group origins and drag deltas.

**Delete keeps children.** Deleting a group reparents its direct children to the
deleted group's parent (or World), preserving their world positions and nested
subtrees. Group creation, parenting, movement and deletion support Undo/Redo.
Save/Open retains the full hierarchy.

World files remain flat JSON arrays. The reserved top-level `spatial` field is
separate from ordinary renderer properties and legacy `group` labels:

```json
[
  { "x": 100, "y": 50, "name": "Town", "spatial": { "id": "town", "group": true } },
  { "x": 20, "y": 10, "name": "House", "spatial": { "id": "house", "group": true, "parent": "town" } },
  { "x": 5, "y": 8, "render": "rectangle", "width": 32, "height": 16, "color": "red", "spatial": { "id": "door", "parent": "house" } }
]
```

Here Door's world position is `(125, 68)`. Every spatial record has a unique
non-empty string `id`; optional `parent` references another spatial record whose
`group` is `true`. Omit `parent` for a world-relative record. Unknown spatial
fields, malformed metadata, duplicate spatial IDs, missing/non-group parents and
cycles are errors. IDs are independent of an object's ordinary `id` property.
The editor generates spatial IDs when creating groups or parenting legacy objects.
`spatial` is edited through the group/parent controls, not the Properties popup.

Existing arrays without `spatial` retain their positions and fields. Legacy
`group` properties remain organizational, contiguous stacking blocks with their
existing collapse/reorder actions; they do not define spatial parents. Their
collapse state is independent of spatial groups. Old arbitrary properties named
`spatial` must be renamed before using this reserved field.

Spatial hierarchy controls coordinates, **not compositing**: leaf objects draw
in flat array order, regardless of parent; changing Parent in the inspector does
not reorder them. Table drops reorder the moved subtree together; spatial Up/Down
uses the same sibling/subtree operation. Legacy organizational heading arrows
retain their block behavior. Groups
have editor bounds/markers, not renderer artwork. There is no rotation, scale,
clipping or alternate world DSL.

## Table drag/drop

Drag an object row onto another row: ordinary rows use their upper/lower halves
for **before/after**; spatial group rows use their upper/lower quarters for
**before/after** and their center for **inside**. Before/after means top-first
sidebar order and adopts the target's parent. Inside adds a topmost child and
expands a collapsed target after a successful move. A group moves with all its
descendants, preserving their internal stacking and world positions. If stored
subtrees are interleaved, the moved and target subtrees are gathered at the target's
sibling boundary so the resulting order matches the displayed slot. The plain
text ghost describes the promised placement; drop on that ghost to commit.
Outlined ghost styling requires the updated shared Host CSS; older released
Hosts still display the text. No View-local styling or Host copy is bundled.

Self/descendant targets, missing targets and non-group inside targets are
rejected. Legacy `group` labels never change during drops; moves that would split
a contiguous legacy block are rejected in both preview and mutation. Legacy
headings are not draggable. No-op drops add no history. One undo command restores
parent/local coordinates, flat order and selection; collapse state is UI-only.
Pending drags cancel before table rerender, during busy operations and on unmount.

Focus rows and use Up/Down to navigate, Enter/Space to select. Row arrow buttons
reorder spatial siblings with their subtrees; the Parent selector provides
keyboard reparenting. Group headings retain Enter/Space collapse controls.

### Local controller API

Canonical `src/drag-drop.mjs` exports `bindDragDrop(root, options)`, returning
`cancel()` and `destroy()`. Make inlines this module for the Host blob loader;
it is View-owned reusable behavior, not a new Host utility. The caller sets
`draggable="true"`, supplies valid markup and keyboard alternatives, calls
`cancel()` before replacing items and `destroy()` on disconnect, and handles
`onDrop` failures. No table tags, World state, styling or axis geometry are built
into the controller. Options:

| Callback/option | Contract |
| --- | --- |
| `itemSelector` | Selector for draggable items under root. |
| `getId(item)` | Stable string ID. World converts IDs to numeric editor IDs. |
| `getPlacement({source,target,event})` | `before`, `after`, `inside`, or `null`. |
| `canDrop({sourceId,targetId,placement})` | Domain validation; World shares its planner with mutation. |
| `createGhost({source,target,placement})` | Valid container child Element; World supplies `tr`/`td`, `data-drag-ghost="true"` and `aria-hidden="true"`. |
| `placeGhost({ghost,target,placement})` | Insert the ghost at its promised location. |
| `onDrop({sourceId,targetId,placement})` | Apply the validated local move. |

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
Native tests cover renderer/registry behavior, spatial state commands, history
command effects and canvas geometry/interactions. Native Host GUI gestures and
full configured plugin integration remain separate checks.
