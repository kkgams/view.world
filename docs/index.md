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
| `make test` | Run native renderer, import, registry and spatial-group tests. |
| `make package` | Build `view.world.zip` and `SHA256SUMS` under `build.nosync/`. |
| `make serve-docs DOCS_PORT=8080` | Preview this wiki with pinned justgook/wiki v1.4.0. |
| `make validate-docs` | Validate wiki content. |
| `make docs` | Build `build.nosync/site/`. |
| `make clean` | Remove all of `build.nosync/`, `tools/` and `gams_modules/`, without ownership markers; refuse tracked files or symlinks in deletion paths before deleting anything. |

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

The ZIP contains `views/view-world.js` (including the registry) and five separate
browser modules under `world-renderers/`. They are not WASM plugins or a separate
Project Unit category. Projects explicitly select modules in
`ui.views.view-world.config.renderers`; there is no automatic discovery.

The local Project uses canonical renderer files under `src/world-renderers/`,
except text, which Make assembles with its layout and GPU helpers into
`build.nosync/world-renderers/text.js` for the Host blob loader.
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
| `nine.js` / `render: "nine"` | `nine`: Project-relative JSON path; `slice`: exact slice name; positive `width`, `height`. | None. |
| `text.js` / `render: "text"` | `font`: Project-relative `.arfont`; `text`: string; positive `fontSize`; hex `color`. | None. |
| `tilemap.js` / `render: "tilemap"` | `tilemap`: Project-relative tilemap path. | Positive one-based `layer`; `repeat: [x, y]` with 0/1 flags for infinite viewport repetition. |

All five accept `config.origin: [x, y]`, normalized from 0 to 1; omission means
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

## Nine-slice objects

The local Project enables `world-renderers/nine.js`, matching `render: "nine"`.
A consumer enables it through the same renderer configuration/archive-entry
contract as the other modules. This renderer supplies its own **Nine slice**
sidebar panel. The configuration key may have any name; World discovers optional
panels by renderer capability, not by ID. Without this renderer, its panel and
slice-specific workflow are absent.

1. Create or open a world.
2. Choose **Import nine-slice JSON** in the **Nine slice** panel and select a
   `gams.nine` version-1 document from the Project.
3. Choose a named slice. Width and Height initially use its source bounds;
   selecting another slice resets both values.
4. Set positive integer Width/Height and click **Add slice object**.

The object is added at the viewport center as one undoable command. The atlas and
slice are checked before adding anything; an invalid document, missing slice or
unreadable image reports an error without adding an object. The imported source
remains available for adding several differently sized objects. Use the existing
Properties action on a selected object to change `nine`, `slice`, `width` or
`height`; normal move, spatial parenting, reorder, delete and Undo/Redo apply.

A stored object looks like:

```json
{
  "x": 100,
  "y": 50,
  "render": "nine",
  "nine": "ui/panels.nine.json",
  "slice": "Window",
  "width": 240,
  "height": 120
}
```

Import does not upload or copy the document/atlas. Both must be accessible in the
Project; the document's `image` path is Project-relative, regardless of the JSON
file's directory. Save/Open retains the JSON path, exact slice name and target
size. Keep both input files with the Project. Documents/images are cached while
used; reopen the Project after editing those source files externally.

The renderer reads the format produced by view.nine: `format: "gams.nine"`,
`version: 1`, `image` and named `slices` with pixel `bounds` and bounds-relative
`center`. It supports `nine`, `horizontal`, `vertical` and `region` slices.
PNG, JPEG and WebP atlas images are supported. Duplicate names, malformed pixel
rectangles, invalid centers, unknown slice types and out-of-atlas bounds fail.

Nine-slices retain fixed-size corners. Top and bottom repeat horizontally, left
and right repeat vertically, and the center repeats on both axes. Tiles keep
their source size, with the last tile cropped as needed. Each
slice provides minimum dimensions from its fixed borders and maximum dimensions
for any fixed axis; border sizes never shrink to fit. The limits come from the
existing slice geometry, not
additional authored JSON fields:

| Slice type | Width range | Height range | Handles |
| --- | --- | --- | --- |
| `nine` | From `max(1, bounds.width - center.width)`, no maximum | From `max(1, bounds.height - center.height)`, no maximum | Eight |
| `horizontal` | From `max(1, bounds.width - center.width)`, no maximum | Fixed at `bounds.height` | Left/right |
| `vertical` | Fixed at `bounds.width` | From `max(1, bounds.height - center.height)`, no maximum | Top/bottom |
| `region` | Fixed at `bounds.width` | Fixed at `bounds.height` | None |

At the exact fixed-border minimum, the repeating span on that axis is omitted.
The import form exposes these limits and disables fixed dimensions. Handles stop
at the applicable limits; sizes outside them in files or numeric edits are rejected. Invalid property edits leave the world
unchanged. The pause example's `menu-border` has minimum dimensions **641 × 622**.

Horizontal/vertical slices repeat the middle segment only along their active
axis; the other axis stays at its source size. A plain region draws at its source
size and can move but cannot resize. Drawing uses nearest-neighbor sampling.
Renderer `config.origin` controls destination bounds as for sprites.

## Text objects

Text is an independently selectable renderer, not a special World object type.
Enable `world-renderers/text.js` with `match: { "render": "text" }` using the
same explicit module configuration as other renderers. Omitting it omits its
sidebar panel; arbitrary World properties and game-pipeline policy are unchanged.

Load the released font backend in the Project's `plugins` array (the World
View ZIP does not bundle it):

```json
{ "$file": "https://github.com/kkgams/plugin.font/releases/download/v0.1.1/plugin.font.wasm" }
```

1. Generate an atlas in view-font (`plugin.font`) and **Save** it as an `.arfont`
   inside the Project.
2. In World's **Text** panel choose **Import Artery font** and select that file.
3. Enter multiline Text, positive Font size and Color (`#RRGGBB` or `#RRGGBBAA`).
4. Choose **Add text object** to place it at viewport center as one undoable action.

```json
{
  "x": 100,
  "y": 50,
  "render": "text",
  "font": "fonts/interface.arfont",
  "text": "Beware below\nMind the gap",
  "fontSize": 24,
  "color": "#ffffff"
}
```

Use Properties to change these fields. Existing movement, spatial parenting,
reorder, delete, Save/Open and Undo/Redo apply. Parent a border and its text to the
same spatial group to move them together; no attachment, clipping or layout is
implied. Labels and author comments are ordinary objects: pipelines decide which
to keep. The renderer does not interpret purpose/comment flags.

The `.arfont` contains atlas pixels, glyphs, kerning and metrics in one file.
Paths are **Project-relative**. Assets are referenced, never copied. Reopen the
Project after external font edits because decoded fonts are cached while
referenced. JSON/PNG font loading has been removed; save an `.arfont` in view-font
and update existing text objects' `font` paths.

The `plugin.font` decoder accepts one float32 Unicode variant and one tightly
packed, bottom-up raw unsigned 8-bit atlas: SDF/PSDF (one channel), MSDF (three)
or MTSDF (four). Encoded images, multiple variants/atlases, appendices, vertical
advances and nonzero `distanceRangeMiddle` are unsupported. Malformed payloads,
checksum failures and unsupported layouts fail explicitly. World uploads raw
channels directly to WebGL without PNG decoding, premultiplication or color
conversion, preserving MTSDF RGB beneath zero alpha. The owned backend resource
is released after metadata/pixels have been extracted, including on failure.

Glyph bounds, advances, kerning and line metrics use font units; Font size is
world units per em (`fontSize / metrics.emSize` scales those metrics). Explicit
newlines advance by `metrics.lineHeight`; CRLF is treated as one newline.
Missing glyphs, malformed Unicode or metadata, out-of-atlas bounds and
pixel-count mismatches are errors.

Text uses left-aligned line boxes, including spaces and blank lines, expanded to
include glyph overhangs. `config.origin` anchors this complete measured box;
default `[0, 0]` is top-left. Empty/whitespace-only text retains positive selection
bounds even without visible glyphs. No resize handles are provided: change
`fontSize` through Properties. There is no wrapping, complex-script shaping,
font fallback, outline or shadow in this implementation.

A transparent offscreen WebGL2 canvas renders distance fields at the current 2D
canvas transform scale, then composites into World without changing object order.
WebGL2 is required for visible text; unavailable/lost contexts and oversized
textures/text surfaces fail explicitly. Resources are released on eviction and
disposal. This does not introduce a WebGL requirement for Projects without text.

## Resize objects

Select an unlocked nine-slice, rectangle or sprite to show its permitted handles.
Two-axis objects have eight handles; single-axis objects have two edge handles;
fixed-size objects have none. Drag an edge to resize one dimension or a corner
to resize both. Handles keep a
constant screen size at different zoom levels and take priority over object
movement. Ordinary interior dragging still moves the object. Spatial groups,
points and tilemaps have no resize handles.

The opposite edge/corner stays anchored while the dragged edge moves. The editor
updates position as needed for the renderer origin and parent-relative coordinates;
axis inversion is supported. Pointer deltas snap to world pixels and changed
dimensions clamp to the renderer's minimum/maximum without flipping (minimum
one pixel and no maximum when no limits are supplied). World positions remain
integers: for fractional renderer origins, position rounding can shift the anchored
edge by at most half a world pixel. Top-left origins have no such shift.

Resizing previews without changing saved state. Releasing the primary button
commits position and renderer properties together in one **Resize object** undo
command. No-op gestures add no history. Escape, window focus loss, lost mouse
button, disconnect or an external state refresh discards the preview. Dragging
and releasing outside the canvas still completes the gesture. The viewport does
not pan with Space during a resize. Existing Properties editing provides the
keyboard alternative for width/height; the position inspector adjusts X/Y.

Nine-slice resizing changes its destination dimensions while retaining fixed
corners, stopping when they occupy the entire destination. It does not scale the entire atlas. A sprite initially using
natural image size gains explicit width/height when resized. Aspect-ratio locking,
mirroring and spatial-group scaling are not part of this interaction.

### Renderer resize contract

A renderer opts in by providing a synchronous method:

```js
resize(object, { width, height }) {
  return { width, height }
}
```

The requested width and height are positive finite numbers in object-local canvas
units. Return a plain JSON property patch without mutating the object or size
argument. The View merges the patch into the original properties and verifies
that `bounds()` now has the requested dimensions. Bounds may have nonzero origin
offsets; the View owns the corresponding position adjustment. Resizing must work
synchronously with already prepared resources: do not change the renderer match,
source paths, organizational group or spatial metadata. A missing method means
no resize support; a present non-function method or malformed patch is an error.

A renderer may also implement synchronous `resizeLimits(object)`, returning
`{ minWidth, minHeight, maxWidth?, maxHeight? }` for that particular object.
Minima must be positive finite numbers; a supplied maximum must be finite and at
least its corresponding minimum. An omitted maximum is unbounded. Omitting the
method means `{ minWidth: 1, minHeight: 1 }` with no maxima. Equal minimum/maximum
fixes an axis: only handles compatible with the remaining axes are shown. Fixing
both axes makes that object non-resizable even if its renderer has `resize()`.

The View clamps requested dimensions before calculating the anchored position
or calling `resize()`. The nine-slice renderer derives ranges from the selected
slice; `nineSliceLimits(slice)` exposes the same calculation for its own controls.

`WorldObjectRendererRegistry.canResize(object)` reports support for the actually
matched renderer; `resizeLimits(object)` validates its limits, and `resize(object,
size)` rejects requests outside the limits and fully fixed objects before dispatching.
The View owns handles, hit testing, pixel snapping, anchoring, preview/cancellation
and history. Renderers own which properties represent their dimensions.

## Renderer sidebar panels

Configured renderers can optionally provide a synchronous factory:

```js
createSidebarPanel({ addObject }) {
  const element = document.createElement("fieldset")
  // Add a legend and controls using the documented View UI vocabulary.
  return {
    element,
    dispose() {
      // Remove listeners and invalidate pending panel operations.
    }
  }
}
```

Return a detached `fieldset` and a `dispose()` function. The renderer owns its
markup, event handlers, transient panel state, resource selection and validation.
Use the existing popup/tooltip/toast services and Host semantic styling; no
View-local CSS or standalone popups. Factories without panels are simply omitted;
a malformed optional factory or result is an error. The internal point fallback
does not contribute a panel.

World mounts these fieldsets before History and disables each root while busy or
without an open world. A panel must independently disable controls while its own
operation is pending or required input is absent. World disposes/removes panels
before disposing renderers on disconnect, and recreates them on reconnect without
reopening the world or losing unsaved edits/history. Transient panel imports reset.
A disposed panel must ignore late chooser/read/add results and not show new toasts.

`await addObject(properties)` is the only supplied editing callback. World applies
the renderer's configured `match` properties, validates/prepares the candidate,
places it at the viewport center, selects it and records one undo command. It
returns the editor object ID. Invalid candidates add no object or history; stale
callbacks after disconnect are rejected. The panel handles action errors through
UI Services and must not directly mutate World state.

The registry's `createSidebarPanels({ addObject })` discovers these optional
capabilities and binds the configured match properties. World contains no slice
parser, renderer-specific control markup, source-field names or special renderer
ID checks.
