"""Keep host entries inside ZIPs so case-sensitive names survive macOS builds."""
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def assemble(source, rebuilt, addon, output):
    with ZipFile(source) as original, ZipFile(rebuilt) as patched:
        if "classes4.dex" in original.namelist():
            raise ValueError("Unexpected classes4.dex collision")
        # All host hooks in package.mjs modify smali_classes2 only.
        host_dex = patched.read("classes2.dex")
        with ZipFile(output, "w") as result:
            for entry in original.infolist():
                name = entry.filename
                if name.startswith("META-INF/") and (
                    name == "META-INF/MANIFEST.MF"
                    or name.endswith((".SF", ".RSA", ".DSA", ".EC"))
                ):
                    continue
                data = host_dex if name == "classes2.dex" else original.read(entry)
                result.writestr(entry, data)
            result.writestr("classes4.dex", Path(addon).read_bytes(), ZIP_DEFLATED)


if __name__ == "__main__":
    assemble(*sys.argv[1:])
