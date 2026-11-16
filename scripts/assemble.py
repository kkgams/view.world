"""Inline the View-owned renderer registry for the Host's blob module loader."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
registry = (ROOT / "src/world-object-renderers.js").read_text()
loader_import = 'import { require } from "/util/require.js"'
registry_export = "export class WorldObjectRendererRegistry"
view_import = 'import { WorldObjectRendererRegistry } from "../world-object-renderers.js"'
view = (ROOT / "src/views/view-world.js").read_text()
for source, marker in ((registry, loader_import), (registry, registry_export), (view, view_import)):
    if source.count(marker) != 1:
        raise SystemExit(f"Expected exactly one {marker}")
registry = registry.replace(loader_import, "").replace(registry_export, "class WorldObjectRendererRegistry")
# Scope registry helpers separately from the View's similarly named helpers.
inline = loader_import + "\nconst WorldObjectRendererRegistry = (() => {\n" + registry + "\nreturn WorldObjectRendererRegistry\n})()"
output = ROOT / "build.nosync/views/view-world.js"
output.parent.mkdir(parents=True, exist_ok=True)
spatial_import = 'import { isSpatialGroup, spatialParent, validateSpatial, worldPosition, spatialDescendants } from "../spatial.mjs"'
spatial = (ROOT / "src/spatial.mjs").read_text().replace("export function", "function")
spatial_inline = "const { isSpatialGroup, spatialParent, validateSpatial, worldPosition, spatialDescendants } = (() => {\n" + spatial + "\nreturn { isSpatialGroup, spatialParent, validateSpatial, worldPosition, spatialDescendants }\n})()"
if view.count(spatial_import) != 1:
    raise SystemExit("Expected spatial import")
drag_import = 'import { bindDragDrop } from "../drag-drop.mjs"'
drag = (ROOT / "src/drag-drop.mjs").read_text().replace("export function", "function")
if view.count(drag_import) != 1:
    raise SystemExit("Expected drag/drop import")
drag_inline = "const { bindDragDrop } = (() => {\n" + drag + "\nreturn { bindDragDrop }\n})()"
resize_import = 'import { resizeHandles, hitResizeHandle, resizeBounds } from "../resize.mjs"'
resize = (ROOT / "src/resize.mjs").read_text().replace("export function", "function")
if view.count(resize_import) != 1:
    raise SystemExit("Expected resize import")
resize_inline = "const { resizeHandles, hitResizeHandle, resizeBounds } = (() => {\n" + resize + "\nreturn { resizeHandles, hitResizeHandle, resizeBounds }\n})()"
output.write_text(view.replace(view_import, inline).replace(spatial_import, spatial_inline).replace(drag_import, drag_inline).replace(resize_import, resize_inline))
