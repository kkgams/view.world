"""Assemble the optional text renderer for the Host's blob module loader."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / "src/world-renderers/text.js").read_text()
helpers = [
    ("text-model", "fontProjectPath, validateFontDocument, textObjectData, layoutWorldText"),
    ("text-raster", "createTextRaster"),
]
for filename, names in helpers:
    marker = f'import {{ {names} }} from "../{filename}.js"'
    if source.count(marker) != 1:
        raise SystemExit(f"Expected exactly one {marker}")
    body = (root / f"src/{filename}.js").read_text().replace("export function", "function")
    inline = f"const {{ {names} }} = (() => {{\n{body}\nreturn {{ {names} }}\n}})()"
    source = source.replace(marker, inline)
output = root / "build.nosync/world-renderers/text.js"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(source)
