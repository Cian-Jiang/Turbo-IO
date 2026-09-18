"""Run with python3 android-addon/tests/assemble-apk-test.py; no host APK needed."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_STORED

spec = importlib.util.spec_from_file_location(
    "assemble_apk", Path(__file__).resolve().parents[1] / "assemble-apk.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with TemporaryDirectory() as directory:
    source, rebuilt, addon, output = [Path(directory) / n for n in
                                      ("source.apk", "rebuilt.apk", "addon.dex", "out.apk")]
    entries = {
        "res/Uk.xml": b"notification vector",
        "res/uK.xml": b"unrelated layout",
        "assets/A": b"upper asset",
        "assets/a": b"lower asset",
        "resources.arsc": b"original table",
        "AndroidManifest.xml": b"original manifest",
        "lib/arm64-v8a/libexample.so": b"native library",
        "classes.dex": b"original primary dex",
        "classes2.dex": b"original hooked dex",
        "classes3.dex": b"original third dex",
        "META-INF/example.kotlin_module": b"keep metadata",
    }
    with ZipFile(source, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data, ZIP_STORED)
        archive.writestr("META-INF/CERT.RSA", b"old signature")
        archive.writestr("META-INF/CERT.SF", b"old digest")
        archive.writestr("META-INF/MANIFEST.MF", b"old manifest")
    with ZipFile(rebuilt, "w") as archive:
        archive.writestr("classes2.dex", b"patched dex")
        archive.writestr("res/Uk.xml", b"wrong layout after filesystem collision")
    addon.write_bytes(b"addon dex")
    module.assemble(source, rebuilt, addon, output)
    with ZipFile(output) as archive:
        assert set(archive.namelist()) == set(entries) | {"classes4.dex"}
        for name, data in entries.items():
            assert archive.read(name) == (b"patched dex" if name == "classes2.dex" else data), name
            assert archive.getinfo(name).compress_type == ZIP_STORED
        assert archive.read("classes4.dex") == b"addon dex"
    with ZipFile(source, "a") as archive:
        archive.writestr("classes4.dex", b"existing dex")
    try:
        module.assemble(source, rebuilt, addon, output)
    except ValueError:
        pass
    else:
        raise AssertionError("Must reject an existing classes4.dex")
print("PASS: case-sensitive resources, original entries, patched DEX and collision rejection")
