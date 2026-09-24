#!/usr/bin/env python3
"""Create deterministic development archives. Never package profiles or backups."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent
output = root / "dist" / "packages"
output.mkdir(parents=True, exist_ok=True)
checksums = []
for browser in ("chrome", "firefox"):
    folder = root / "dist" / browser
    if not folder.is_dir():
        raise SystemExit("Build both extensions before packaging")
    manifest = json.loads((folder / "manifest.json").read_text())
    if "Development" not in manifest["name"]:
        raise SystemExit("This packager is for development artifacts only")
    path = output / f"qlyphs-wallet-{browser}-development.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for item in sorted(folder.rglob("*")):
            if item.is_symlink():
                raise SystemExit("Refusing symlinks in distributable")
            if not item.is_file():
                continue
            relative = item.relative_to(folder)
            if any(p.startswith(".") for p in relative.parts) or item.suffix not in {".json", ".js", ".wasm", ".png", ".html", ".css", ".txt", ".woff2"}:
                raise SystemExit(f"Unexpected build artifact: {relative}")
            info = zipfile.ZipInfo(relative.as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, item.read_bytes(), compresslevel=9)
    checksums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
(output / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
print("\n".join(checksums))
