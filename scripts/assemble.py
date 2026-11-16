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
output.write_text(view.replace(view_import, inline))
